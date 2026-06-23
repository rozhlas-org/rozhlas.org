import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `souzvuk` — "Souzvuk", via the mujRozhlas JSON:API. Single umbrella show,
 * pinned by UUID (resolved from `/shows?filter[title][eq]=Souzvuk`):
 *   • Souzvuk — c21ff788-8857-31a1-92f1-f26f8db32188
 *
 * Transcription on: the bulk back-catalogue was loaded with it off; now flipped
 * on so future episodes transcribe normally (already-loaded files stay
 * un-transcribed unless deliberately backfilled).
 */
export const souzvukScraper = makeApiScraper({
  key: "souzvuk",
  title: "Souzvuk",
  schedule: "30 10 * * *", // nightly; :30 offset (the hourly slots are taken)
  transcribe: true,
  shows: [{ uuid: "c21ff788-8857-31a1-92f1-f26f8db32188", name: "Souzvuk" }],
});
