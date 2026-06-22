import { config, createLogger } from "@rozhlas/core";
import { getQueue } from "@rozhlas/jobs";
import { listScrapers } from "@rozhlas/scrapers";
import { transcriptionEnabled, groqEnabled } from "@rozhlas/media";
import { enqueuePendingArtworks, enqueuePendingTranscripts, upsertSource } from "./repo.ts";

const log = createLogger("worker:scheduler");

/**
 * Seed the `sources` table from the registry and register a repeatable `discover`
 * job per source that has a schedule. Idempotent — safe to run on every boot.
 */
export async function setupSchedules() {
  const discoverQ = getQueue("discover");
  for (const s of listScrapers()) {
    await upsertSource(s.key, s.title ?? s.key, s.schedule, s.transcribe ?? true);
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

  // Historical backfill: only when explicitly enabled (off by default). New shows
  // are transcribed from ipfs-verify; draining all ~13k pinned files is a ~year of
  // CPU grinding, meant for an off-box GPU/Groq batch — not an automatic boot task.
  if (transcriptionEnabled() && config.TRANSCRIBE_BACKFILL) {
    const txPending = await enqueuePendingTranscripts();
    if (txPending) log.warn("TRANSCRIBE_BACKFILL on — queued full transcript backfill", { pending: txPending });
  }

  // Groq free-tier backfill: a self-paced repeatable tick (one file/min, newest-first).
  // The tick itself no-ops if GROQ_BACKFILL_ENABLED is off, but only register the
  // schedule when it's on so we don't churn an idle queue.
  if (groqEnabled()) {
    await getQueue("groq-backfill").upsertJobScheduler(
      "groq-backfill",
      { pattern: "* * * * *" }, // every minute; the rate gate paces actual submissions
      { name: "groq-backfill", data: {}, opts: { removeOnComplete: true, removeOnFail: { count: 100 } } },
    );
    log.info("groq backfill scheduled (newest-first, self-paced)");
  }
}
