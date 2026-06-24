import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `osobnost-plus` — "Osobnost Plus", Český rozhlas Plus interview programme, via
 * the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Osobnost Plus — ad21758a-b517-328e-9bb0-2a2e2819f0b5
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const osobnostPlusScraper = makeApiScraper({
  key: "osobnost-plus",
  title: "Český rozhlas Plus — Osobnost Plus",
  schedule: "43 5,11,17,23 * * *", // every 6h, staggered
  shows: [{ uuid: "ad21758a-b517-328e-9bb0-2a2e2819f0b5", name: "Osobnost Plus" }],
});
