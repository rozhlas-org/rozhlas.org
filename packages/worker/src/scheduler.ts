import { createLogger } from "@rozhlas/core";
import { getQueue } from "@rozhlas/jobs";
import { listScrapers } from "@rozhlas/scrapers";
import { transcriptionEnabled } from "@rozhlas/media";
import { enqueuePendingArtworks, enqueuePendingTranscripts, upsertSource } from "./repo.ts";

const log = createLogger("worker:scheduler");

/**
 * Seed the `sources` table from the registry and register a repeatable `discover`
 * job per source that has a schedule. Idempotent — safe to run on every boot.
 */
export async function setupSchedules() {
  const discoverQ = getQueue("discover");
  for (const s of listScrapers()) {
    await upsertSource(s.key, s.title ?? s.key, s.schedule);
    if (s.schedule) {
      await discoverQ.upsertJobScheduler(
        `discover:${s.key}`,
        { pattern: s.schedule },
        { name: "discover", data: { sourceKey: s.key } },
      );
      log.info("scheduled discover", { sourceKey: s.key, cron: s.schedule });
    }
  }
  // Backfill: queue a thumbnail pin for every cover not yet on IPFS.
  const pending = await enqueuePendingArtworks();
  if (pending) log.info("artwork backfill queued", { pending });

  // Steady-state: queue transcription for any pinned audio without a transcript.
  // Only when whisper is configured — otherwise we'd enqueue thousands of no-ops.
  // (The historical backfill is meant for an off-box GPU/Groq batch, not this box.)
  if (transcriptionEnabled()) {
    const txPending = await enqueuePendingTranscripts();
    if (txPending) log.info("transcription queued", { pending: txPending });
  }
}
