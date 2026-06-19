import type { Job } from "bullmq";
import { createLogger } from "@rozhlas/core";
import { enqueue, type JobData, type QueueName } from "@rozhlas/jobs";
import { getScraper, createScrapeCtx } from "@rozhlas/scrapers";
import { acquireAudio, discardTemp } from "@rozhlas/media";
import { ipfs } from "@rozhlas/ipfs";
import { getProvider, embedShows } from "@rozhlas/embeddings";
import * as repo from "./repo.ts";

const log = createLogger("worker:pipeline");

/** discover → upsert shows + audio rows, enqueue acquire for anything not yet pinned. */
async function discover(job: Job<JobData["discover"]>) {
  const { sourceKey, limit, options } = job.data;
  const scraper = getScraper(sourceKey);
  const ctx = createScrapeCtx({ log: log.child(sourceKey), limit, options });

  const scraped = await scraper.discover(ctx);
  let enqueued = 0;
  for (const s of scraped) {
    const { showId } = await repo.upsertShow(sourceKey, s);
    // Serialized shows have parts (one audio each); podcasts have a single media.
    if (s.parts?.length) {
      for (const part of s.parts) {
        const { audioFileId, needsAcquire } = await repo.upsertPart(showId, part);
        if (needsAcquire) {
          await enqueue("acquire-audio", { audioFileId });
          enqueued++;
        }
      }
    } else if (s.media) {
      const { audioFileId, needsAcquire } = await repo.upsertAudio(showId, s.media);
      if (needsAcquire) {
        await enqueue("acquire-audio", { audioFileId });
        enqueued++;
      }
    }
  }
  await repo.touchSourceRun(sourceKey);
  log.info("discover done", { sourceKey, shows: scraped.length, enqueued });
  return { shows: scraped.length, enqueued };
}

/** acquire-audio → download mp3 / ffmpeg-assemble m4s, probe, store metadata. */
async function acquire(job: Job<JobData["acquire-audio"]>) {
  const { audioFileId } = job.data;
  const audio = await repo.getAudio(audioFileId);
  if (!audio?.manifestUrl) throw new Error(`audio ${audioFileId}: no manifest url`);

  const acquired = await acquireAudio(
    { kind: (audio.manifestKind as "file" | "dash" | "hls") ?? "file", url: audio.manifestUrl },
    `af${audioFileId}`,
  );
  await repo.setAudioMeta(audioFileId, {
    container: acquired.container,
    codec: acquired.codec,
    bitrate: acquired.bitrate,
    durationSec: acquired.durationSec,
    sizeBytes: acquired.sizeBytes,
    checksum: acquired.checksum,
  });
  await enqueue("ipfs-add", { audioFileId, tempPath: acquired.path });
  return { path: acquired.path, sizeBytes: acquired.sizeBytes, codec: acquired.codec };
}

/** ipfs-add → pin to Kubo, record CID, delete the temp file (audio never kept on disk). */
async function ipfsAdd(job: Job<JobData["ipfs-add"]>) {
  const { audioFileId, tempPath } = job.data;
  const { cid, size } = await ipfs.addFile(tempPath);
  await repo.setAudioCid(audioFileId, cid, size);
  await discardTemp(tempPath);
  await enqueue("ipfs-verify", { audioFileId });
  log.info("pinned", { audioFileId, cid });
  return { cid };
}

/** ipfs-verify → confirm the CID streams through the gateway (range request). */
async function ipfsVerify(job: Job<JobData["ipfs-verify"]>) {
  const { audioFileId } = job.data;
  const audio = await repo.getAudio(audioFileId);
  if (!audio?.ipfsCid) throw new Error(`audio ${audioFileId}: no cid`);
  const v = await ipfs.verifyStreamable(audio.ipfsCid);
  await repo.setAudioStreamable(audioFileId, v.streamable);
  if (v.streamable) await enqueue("index", { showId: audio.showId });
  return v;
}

/** index → FTS is trigger-maintained; here we add the vector embedding (Phase 4). */
async function index(job: Job<JobData["index"]>) {
  const { showId } = job.data;
  try {
    await embedShows(getProvider(), { showIds: [showId] });
  } catch (err) {
    log.warn("embed failed (search still works via FTS)", { showId, err: String(err) });
  }
  return { showId, embedded: true };
}

/** Reserved stages (detail-page sources / tag embedding) — Phase 2/3. */
async function reserved(name: QueueName) {
  return async (job: Job) => {
    log.debug(`${name} reserved — skipping`, { jobId: job.id });
    return { skipped: name };
  };
}

export async function buildProcessors(): Promise<
  Partial<Record<QueueName, (job: Job<any>) => Promise<unknown>>>
> {
  return {
    discover,
    "acquire-audio": acquire,
    "ipfs-add": ipfsAdd,
    "ipfs-verify": ipfsVerify,
    index,
    "fetch-metadata": await reserved("fetch-metadata"),
    "extract-tags": await reserved("extract-tags"),
  };
}
