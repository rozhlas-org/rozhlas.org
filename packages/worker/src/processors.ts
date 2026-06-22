import type { Job } from "bullmq";
import { config, createLogger } from "@rozhlas/core";
import { enqueue, type JobData, type QueueName } from "@rozhlas/jobs";
import { getScraper, createScrapeCtx } from "@rozhlas/scrapers";
import {
  acquireAudio,
  discardTemp,
  makeThumbnail,
  transcribeAudio,
  transcriptionEnabled,
  chunkSegments,
  groqTranscribe,
  groqEnabled,
  GroqFileTooLargeError,
  type Transcription,
} from "@rozhlas/media";
import { ipfs } from "@rozhlas/ipfs";
import { getProvider, embedShows, embedTranscriptChunks } from "@rozhlas/embeddings";
import * as repo from "./repo.ts";
import { groqUsedSecondsLastHour, groqRecordUsage, groqHeartbeat } from "./groq-rate.ts";

const log = createLogger("worker:pipeline");

// Hard ceiling for a discover crawl; on timeout the crawler returns its partial
// results so the job always completes (no more wedged, never-ending runs).
const DISCOVER_HARD_MS = 20 * 60_000; // explicit shows land first; give the hub crawl more time

/** discover → upsert shows + audio rows, enqueue acquire for anything not yet pinned. */
async function discover(job: Job<JobData["discover"]>) {
  const { sourceKey, limit, options } = job.data;
  const scraper = getScraper(sourceKey);
  // Watchdog: a hung crawl must never freeze the job forever. On timeout the
  // signal aborts and the crawler returns what it has so far (graceful partial).
  const ac = new AbortController();
  const watchdog = setTimeout(() => ac.abort(), DISCOVER_HARD_MS);
  // Heartbeat while crawling so the job shows live progress in Bull Board.
  const ctx = createScrapeCtx({
    log: log.child(sourceKey),
    limit,
    options,
    signal: ac.signal,
    onProgress: (p) => void job.updateProgress({ stage: "crawl", ...p }),
  });
  const runId = await repo.startScrapeRun(sourceKey);

  try {
    await job.updateProgress({ stage: "crawl", found: 0, fetched: 0 });
    const scraped = await scraper.discover(ctx);
    clearTimeout(watchdog); // crawl finished (or returned partial on abort)
    let enqueued = 0;
    let mirrored = 0;
    for (const [i, s] of scraped.entries()) {
      if (i % 25 === 0) {
        await job.updateProgress({ stage: "save", saved: i, total: scraped.length });
        // Yield so the worker's lock-renewal timer can fire — a tight loop of
        // thousands of synchronous SQLite upserts would otherwise stall the job.
        await new Promise<void>((r) => setImmediate(r));
      }
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
    clearTimeout(watchdog);
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
  // Hard backstop: if acquireAudio doesn't return shortly after the abort (e.g. a
  // hung ffmpeg whose kill doesn't unblock the awaits), reject anyway so the slot
  // frees and the job retries instead of wedging forever (the AbortController
  // watchdog alone proved insufficient).
  let bomb: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, rej) => {
    bomb = setTimeout(() => rej(new Error("acquire timed out")), ACQUIRE_HARD_MS + 30_000);
  });
  try {
    await job.updateProgress({ stage: "start", percent: 0 });
    const acquired = await Promise.race([
      acquireAudio(
        { kind: (audio.manifestKind as "file" | "dash" | "hls") ?? "file", url: audio.manifestUrl },
        `af${audioFileId}`,
        {
          signal: ac.signal,
          // Surface real download progress (and a heartbeat) into Bull Board.
          onProgress: (p) => void job.updateProgress(p),
        },
      ),
      deadline,
    ]);
    await repo.setAudioMeta(audioFileId, {
      container: acquired.container,
      codec: acquired.codec,
      bitrate: acquired.bitrate,
      durationSec: acquired.durationSec,
      sizeBytes: acquired.sizeBytes,
      checksum: acquired.checksum,
    });
    await job.updateProgress({ stage: "done", percent: 100 });
    // Propagate the re-acquire marker so a second lost staging file hard-fails
    // (loop guard) instead of bouncing between acquire and ipfs-add forever.
    await enqueue("ipfs-add", {
      audioFileId,
      tempPath: acquired.path,
      retryMissing: job.data.fromReacquire,
    });
    return { path: acquired.path, sizeBytes: acquired.sizeBytes, codec: acquired.codec };
  } finally {
    clearTimeout(watchdog);
    if (bomb) clearTimeout(bomb);
  }
}

/** ipfs-add → pin to Kubo, record CID, delete the temp file (audio never kept on disk). */
async function ipfsAdd(job: Job<JobData["ipfs-add"]>) {
  const { audioFileId, tempPath, retryMissing } = job.data;
  let cid: string;
  let size: number;
  try {
    ({ cid, size } = await ipfs.addFile(tempPath));
  } catch (err) {
    // The staged file is gone — typically a worker restart wiped it between
    // acquire-audio and ipfs-add (now mitigated by the persistent staging dir).
    // Re-acquire once rather than hard-failing; `retryMissing` guards the loop.
    const missing = (err as { code?: string })?.code === "ENOENT" || /ENOENT/.test(String(err));
    if (missing && !retryMissing) {
      log.warn("ipfs-add: staged file missing, re-acquiring", { audioFileId, tempPath });
      await enqueue("acquire-audio", { audioFileId, fromReacquire: true });
      return { requeued: true };
    }
    throw err;
  }
  await repo.setAudioCid(audioFileId, cid, size);
  await discardTemp(tempPath);
  await enqueue("ipfs-verify", { audioFileId });
  log.info("pinned", { audioFileId, cid });
  return { cid };
}

// Cover images are full-resolution originals (often 1–5 MB) but only ever shown
// as thumbnails. Fetch, resize to a small WebP, pin, and store the CID so the
// site serves a ~30 KB file from our gateway instead of a multi-MB original.
const ARTWORK_HARD_MS = 60_000;

/** acquire-artwork → resize a show's cover to a small WebP, pin to IPFS, store CID. */
async function acquireArtwork(job: Job<JobData["acquire-artwork"]>) {
  const { artworkId } = job.data;
  const art = await repo.getArtwork(artworkId);
  if (!art?.sourceUrl) return { skipped: "no-source" };
  if (art.ipfsCid) return { skipped: "already-pinned" };

  // Many shows share a cover (programme art, default placeholders). If the same
  // source image is already pinned, reuse its CID — no re-download/resize/pin.
  const dup = await repo.findArtworkCidBySource(art.sourceUrl);
  if (dup?.ipfsCid) {
    await repo.setArtworkCid(artworkId, dup.ipfsCid, dup.width ?? 0, dup.height ?? 0);
    return { cid: dup.ipfsCid, deduped: true };
  }

  const ac = new AbortController();
  const watchdog = setTimeout(() => ac.abort(), ARTWORK_HARD_MS);
  try {
    const thumb = await makeThumbnail(art.sourceUrl, `art${artworkId}`, { signal: ac.signal });
    try {
      const { cid } = await ipfs.addFile(thumb.path);
      await repo.setArtworkCid(artworkId, cid, thumb.width, thumb.height);
      log.info("artwork pinned", { artworkId, cid, bytes: thumb.sizeBytes });
      return { cid, bytes: thumb.sizeBytes };
    } finally {
      await discardTemp(thumb.path); // never keep image files on disk (same rule as audio)
    }
  } finally {
    clearTimeout(watchdog);
  }
}

/** ipfs-verify → confirm the CID streams through the gateway (range request). */
async function ipfsVerify(job: Job<JobData["ipfs-verify"]>) {
  const { audioFileId } = job.data;
  const audio = await repo.getAudio(audioFileId);
  if (!audio?.ipfsCid) throw new Error(`audio ${audioFileId}: no cid`);
  const v = await ipfs.verifyStreamable(audio.ipfsCid);
  await repo.setAudioStreamable(audioFileId, v.streamable);
  if (v.streamable) {
    await enqueue("index", { showId: audio.showId });
    // Steady-state: transcribe newly-streamable audio as it arrives (the bulk
    // backfill is a separate, opt-in/off-box concern — see TRANSCRIBE_BACKFILL).
    // Skip sources flagged transcribe=false (high-volume additions we defer).
    if (transcriptionEnabled() && (await repo.sourceTranscribes(audioFileId))) {
      await enqueue("transcribe", { audioFileId }, { jobId: `tx-${audioFileId}`, removeOnComplete: true });
    }
  }
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

// faster-whisper on the i7-6700 runs ~0.9× realtime, so a long episode can take
// hours; cap generously so a genuinely stuck job still frees the slot eventually.
const TRANSCRIBE_HARD_MS = 4 * 60 * 60_000;

/** transcribe → pull pinned audio by CID, run whisper, store transcript + chunks. */
/**
 * Persist a Transcription (from local whisper OR Groq) → chunks + FTS (trigger)
 * + queue the embed stage. Shared by both provider paths so they stay identical.
 */
function storeTranscription(audioFileId: number, showId: number, t: Transcription) {
  const chunks = chunkSegments(t.segments, config.TRANSCRIPT_CHUNK_CHARS);
  const transcriptId = repo.saveTranscript(audioFileId, showId, {
    lang: t.lang,
    model: t.model,
    text: t.text,
    segmentsJson: JSON.stringify(t.segments),
    durationSec: t.durationSec,
    chunks,
  });
  // FTS is trigger-maintained on insert → keyword search works now; embed adds vectors.
  void enqueue("embed-transcript", { transcriptId }, { jobId: `emb-${transcriptId}`, removeOnComplete: true });
  return { transcriptId, segments: t.segments.length, chunks: chunks.length };
}

async function transcribe(job: Job<JobData["transcribe"]>) {
  const { audioFileId } = job.data;
  if (!transcriptionEnabled()) return { skipped: "disabled" }; // WHISPER_PYTHON unset
  const audio = await repo.getAudio(audioFileId);
  if (!audio?.ipfsCid) return { skipped: "no-cid" };
  if (await repo.transcriptExists(audioFileId)) return { skipped: "already" };

  const ac = new AbortController();
  const watchdog = setTimeout(() => ac.abort(), TRANSCRIBE_HARD_MS);
  try {
    await job.updateProgress({ stage: "transcribe", percent: 0 });
    const t = await transcribeAudio(ipfs.gatewayFor(audio.ipfsCid), `af${audioFileId}`, { signal: ac.signal });
    // Re-check: a ~30-min local transcribe gives the Groq backfill (newest-first,
    // fast) ample time to finish the same file. Skip the store instead of colliding
    // on the unique audioFileId. (transcriptExists at job start covers the queued case.)
    if (await repo.transcriptExists(audioFileId)) {
      log.info("transcribe: raced by Groq, discarding result", { audioFileId });
      return { skipped: "raced" };
    }
    const r = storeTranscription(audioFileId, audio.showId, t);
    await job.updateProgress({ stage: "done", percent: 100 });
    log.info("transcribed", { audioFileId, ...r });
    return r;
  } finally {
    clearTimeout(watchdog);
  }
}

// Groq free-tier backfill: one file per tick, newest broadcast first, self-paced
// under the audio-seconds/hour limit. Files too large after transcode are skipped
// in-session so the cursor advances (persistent skip is a follow-up).
const GROQ_TICK_HARD_MS = 12 * 60_000;
const groqSkip = new Set<number>(); // oversized/failed this session — don't re-pick

async function groqBackfillTick(_job: Job<JobData["groq-backfill"]>) {
  if (!groqEnabled()) return { skipped: "disabled" };
  await groqHeartbeat(); // dead-man's-switch reads this
  const used = await groqUsedSecondsLastHour();
  if (used >= config.GROQ_AUDIO_SECONDS_PER_HOUR) return { skipped: "rate" };

  const next = await repo.nextUntranscribedByDate([...groqSkip]);
  if (!next?.cid) return { skipped: "drained" };
  // Don't blow the hourly budget with this one file.
  if (used + (next.durationSec ?? 0) > config.GROQ_AUDIO_SECONDS_PER_HOUR) return { skipped: "rate-file" };
  if (await repo.transcriptExists(next.id)) return { skipped: "race" };

  const ac = new AbortController();
  const watchdog = setTimeout(() => ac.abort(), GROQ_TICK_HARD_MS);
  try {
    const t = await groqTranscribe(ipfs.gatewayFor(next.cid), `af${next.id}`, { signal: ac.signal });
    if (await repo.transcriptExists(next.id)) return { skipped: "raced", audioFileId: next.id }; // local won
    const r = storeTranscription(next.id, next.showId, t);
    await groqRecordUsage(t.durationSec || next.durationSec || 0);
    log.info("groq backfilled", { audioFileId: next.id, ...r });
    return { audioFileId: next.id, ...r };
  } catch (err) {
    if (err instanceof GroqFileTooLargeError) {
      groqSkip.add(next.id); // multi-hour outlier — defer
      log.warn("groq skip (too large)", { audioFileId: next.id, err: err.message });
      return { skipped: "too-large", audioFileId: next.id };
    }
    if ((err as { status?: number }).status === 429) {
      log.warn("groq 429 — backing off", { audioFileId: next.id });
      return { skipped: "429" }; // rate gate will catch up; don't fail/retry-storm
    }
    groqSkip.add(next.id); // transient/odd failure — skip this session so the cursor advances
    log.error("groq backfill failed", { audioFileId: next.id, err: String(err).slice(0, 200) });
    return { skipped: "error", audioFileId: next.id };
  } finally {
    clearTimeout(watchdog);
  }
}

/** embed-transcript → embed a transcript's chunks into vec_chunks (Voyage). */
async function embedTranscript(job: Job<JobData["embed-transcript"]>) {
  const { transcriptId } = job.data;
  const r = await embedTranscriptChunks(getProvider(), { transcriptId });
  log.info("embedded transcript", { transcriptId, ...r });
  return r;
}

export async function buildProcessors(): Promise<
  Partial<Record<QueueName, (job: Job<any>) => Promise<unknown>>>
> {
  return {
    discover,
    "acquire-audio": acquire,
    "acquire-artwork": acquireArtwork,
    "ipfs-add": ipfsAdd,
    "ipfs-verify": ipfsVerify,
    index,
    transcribe,
    "groq-backfill": groqBackfillTick,
    "embed-transcript": embedTranscript,
    "fetch-metadata": await reserved("fetch-metadata"),
    "extract-tags": await reserved("extract-tags"),
  };
}
