import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `kriminalka` — "Kriminálka", Český rozhlas true-crime podcast by Mirek Vaňura,
 * via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Kriminálka — a55b623e-80ba-3b9c-9b6d-fd2a5e245276
 *
 * Transcription ON (default): local whisper is disabled (WHISPER_PYTHON unset), so
 * nothing grinds the CPU — the whole back-catalogue is transcribed from the start by
 * the Groq backfill (which only picks sources with transcribe=true), paced by its rate.
 */
export const kriminalkaScraper = makeApiScraper({
  key: "kriminalka",
  title: "Český rozhlas — Kriminálka",
  schedule: "25 1,7,13,19 * * *", // every 6h, staggered
  shows: [{ uuid: "a55b623e-80ba-3b9c-9b6d-fd2a5e245276", name: "Kriminálka" }],
});
