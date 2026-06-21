import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `historie-plus` — "Historie Plus", Český rozhlas Plus history documentary
 * programme, via the mujRozhlas JSON:API. Single umbrella show, pinned by UUID
 * (resolved from `/shows?filter[title][eq]=Historie Plus`):
 *   • Historie Plus — 6f1d6fd8-db19-3fc8-8cfc-4b8aed97ee53
 *
 * `transcribe: false` — this is a large back-catalogue; we deliberately skip
 * transcription for now to avoid flooding the (CPU-bound) transcribe queue.
 */
export const historiePlusScraper = makeApiScraper({
  key: "historie-plus",
  title: "Český rozhlas Plus — Historie Plus",
  schedule: "0 9 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "6f1d6fd8-db19-3fc8-8cfc-4b8aed97ee53", name: "Historie Plus" }],
});
