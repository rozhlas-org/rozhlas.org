import { createLogger } from "@rozhlas/core";
import { getQueue } from "@rozhlas/jobs";
import { listScrapers } from "@rozhlas/scrapers";
import { upsertSource } from "./repo.ts";

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
}
