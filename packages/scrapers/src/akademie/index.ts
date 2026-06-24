import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `akademie` — "Akademie", Český rozhlas Vltava thematic music-evening programme,
 * via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Akademie — 093f7f41-a78e-32ef-bc3a-573edb7ef308
 *
 * Transcription on: the bulk back-catalogue was loaded with it off; now flipped on
 * so future episodes transcribe normally (already-loaded files stay un-transcribed
 * unless deliberately backfilled).
 */
export const akademieScraper = makeApiScraper({
  key: "akademie",
  title: "Český rozhlas Vltava — Akademie",
  schedule: "13 1,7,13,19 * * *", // every 6h, staggered
  transcribe: true,
  shows: [{ uuid: "093f7f41-a78e-32ef-bc3a-573edb7ef308", name: "Akademie" }],
});
