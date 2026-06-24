import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `hlasy-pameti` — "Hlasy paměti", Český rozhlas Plus documentary podcast about
 * the 20th century, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Hlasy paměti — ccb2d6ca-197a-3e19-a8da-f3bb33c5616f
 *
 * Transcription on: the bulk back-catalogue was loaded with it off; now flipped on
 * so future episodes transcribe normally (already-loaded files stay un-transcribed
 * unless deliberately backfilled).
 */
export const hlasyPametiScraper = makeApiScraper({
  key: "hlasy-pameti",
  title: "Český rozhlas Plus — Hlasy paměti",
  schedule: "13 0,6,12,18 * * *", // every 6h, staggered
  transcribe: true,
  shows: [{ uuid: "ccb2d6ca-197a-3e19-a8da-f3bb33c5616f", name: "Hlasy paměti" }],
});
