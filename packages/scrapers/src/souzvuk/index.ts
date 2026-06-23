import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `souzvuk` — "Souzvuk", via the mujRozhlas JSON:API. Single umbrella show,
 * pinned by UUID (resolved from `/shows?filter[title][eq]=Souzvuk`):
 *   • Souzvuk — c21ff788-8857-31a1-92f1-f26f8db32188
 *
 * Transcription is OFF for now: the one-time bulk back-catalogue is loaded
 * without it (keeps the CPU whisper queue clear). Flip — remove `transcribe`
 * (defaults to true) once the backfill is in — to transcribe future episodes.
 */
export const souzvukScraper = makeApiScraper({
  key: "souzvuk",
  title: "Souzvuk",
  schedule: "30 10 * * *", // nightly; :30 offset (the hourly slots are taken)
  transcribe: false,
  shows: [{ uuid: "c21ff788-8857-31a1-92f1-f26f8db32188", name: "Souzvuk" }],
});
