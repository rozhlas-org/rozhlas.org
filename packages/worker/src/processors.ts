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
  // Heartbeat while crawling so the job shows live progress in Bull Board.
  const ctx = createScrapeCtx({
    log: log.child(sourceKey),
    limit,
    options,
    onProgress: (p) => void job.updateProgress({ stage: "crawl", ...p }),
  });
  const runId = await repo.startScrapeRun(sourceKey);

  try {
    await job.updateProgress({ stage: "crawl", found: 0, fetched: 0 });
    const scraped = await scraper.discover(ctx);
    let enqueued = 0;
    let mirrored = 0;
    for (const [i, s] of scraped.entries()) {
      if (i % 10 === 0) await job.updateProgress({ stage: "save", saved: i, total: scraped.length });
      const { showId, mirrored: isMirror } = await repo.upsertShow(sourceKey, s);
      if (isMirror) {
        // Already owned by another source (station mirror) — skip its audio.
        mirrored++;
        continue;
      }
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
    // discovered = shows seen this run; succeeded = NEW audio queued (the "diff").
    await repo.finishScrapeRun(runId, { status: "ok", discovered: scraped.length, succeeded: enqueued });
    await job.updateProgress({ stage: "done", found: scraped.length, enqueued });
    log.info("discover done", { sourceKey, shows: scraped.length, enqueued, mirrored });
    return { shows: scraped.length, enqueued, mirrored };
  } catch (err) {
    await repo.finishScrapeRun(runId, { status: "error", error: String(err).slice(0, 500) });
    throw err;
  }
}

// Hard ceiling for a single acquire job; the watchdog aborts the download/ffmpeg
// so a wedged source fails → retries instead of holding a worker slot forever.
const ACQUIRE_HARD_MS = 5 * 60_000;

/** acquire-audio → download mp3 / ffmpeg-assemble m4s, probe, store metadata. */
async function acquire(job: Job<JobData["acquire-audio"]>) {
  const { audioFileId } = job.data;
  const audio = await repo.getAudio(audioFileId);
  if (!audio?.manifestUrl) throw new Error(`audio ${audioFileId}: no manifest url`);

  const ac = new AbortController();
  const watchdog = setTimeout(() => ac.abort(), ACQUIRE_HARD_MS);
  try {
    await job.updateProgress({ stage: "start", percent: 0 });
    const acquired = await acquireAudio(
      { kind: (audio.manifestKind as "file" | "dash" | "hls") ?? "file", url: audio.manifestUrl },
      `af${audioFileId}`,
      {
        signal: ac.signal,
        // Surface real download progress (and a heartbeat) into Bull Board.
        onProgress: (p) => void job.updateProgress(p),
      },
    );
    await repo.setAudioMeta(audioFileId, {
      container: acquired.container,
      codec: acquired.codec,
      bitrate: acquired.bitrate,
      durationSec: acquired.durationSec,
      sizeBytes: acquired.sizeBytes,
      checksum: acquired.checksum,
    });
    await job.updateProgress({ stage: "done", percent: 100 });
    await enqueue("ipfs-add", { audioFileId, tempPath: acquired.path });
    return { path: acquired.path, sizeBytes: acquired.sizeBytes, codec: acquired.codec };
  } finally {
    clearTimeout(watchdog);
  }
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
