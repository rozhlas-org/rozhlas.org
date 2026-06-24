import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `historie-plus` — "Historie Plus", Český rozhlas Plus history documentary
 * programme, via the mujRozhlas JSON:API. Single umbrella show, pinned by UUID
 * (resolved from `/shows?filter[title][eq]=Historie Plus`):
 *   • Historie Plus — 6f1d6fd8-db19-3fc8-8cfc-4b8aed97ee53
 *
 * Transcription is on (default): the one-time bulk back-catalogue was loaded with
 * it off; now future episodes transcribe normally. The already-loaded files stay
 * un-transcribed (only a deliberate backfill would pick them up).
 */
export const historiePlusScraper = makeApiScraper({
  key: "historie-plus",
  title: "Český rozhlas Plus — Historie Plus",
  schedule: "7 4,10,16,22 * * *", // every 6h, staggered
  shows: [{ uuid: "6f1d6fd8-db19-3fc8-8cfc-4b8aed97ee53", name: "Historie Plus" }],
});
