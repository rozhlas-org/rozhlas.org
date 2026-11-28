import { createLogger, databaseFile } from "@rozhlas/core";

/**
 * Keep the SQLite file resident in the OS page cache. The DB lives on spinning disks
 * shared with IPFS blocks, staging audio and RAID scrubs; once its pages get evicted,
 * a search's scattered reads (FTS doclists, bm25 docsizes, show rows) turn into
 * thousands of seeks — seconds per query. A periodic sequential read of the whole file
 * (~3 GB, a small slice of RAM) is near-free while it's cached and, when it isn't,
 * re-reads it at streaming speed instead of seek by seek under a user's search.
 */

const log = createLogger("api:cache-warm");
const INTERVAL_MS = 10 * 60_000;
const SLOW_MS = 5_000; // a pass this slow means pages had been evicted — worth a log line

export function startCacheWarmer(): void {
  let running = false;
  const warm = async () => {
    if (running) return;
    running = true;
    const t0 = performance.now();
    let bytes = 0;
    try {
      for await (const chunk of Bun.file(databaseFile).stream()) bytes += chunk.byteLength;
      const ms = Math.round(performance.now() - t0);
      const fields = { mb: Math.round(bytes / 1048576), ms };
      if (ms > SLOW_MS) log.info("db page cache re-warmed", fields);
      else log.debug("db page cache warm", fields);
    } catch (err) {
      log.warn("db page cache warm failed", { err: String(err) });
    } finally {
      running = false;
    }
  };
  setTimeout(warm, 5_000);
  setInterval(warm, INTERVAL_MS);
}
