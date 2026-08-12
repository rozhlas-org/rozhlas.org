import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `tip-mujrozhlas` — "Tip mujRozhlas", a cross-station curation strand ("Vybíráme
 * pro Vás populární kousky z uplynulých let a velká i malá díla z archivu Českého
 * rozhlasu"). A small, mostly-literary grab-bag of readings and radio drama pinned
 * by its single umbrella show UUID.
 *   • Tip mujRozhlas — 7215c9c8-4d4a-3263-9c0b-f8aa6c310fd5
 *
 * Transcription on (default) — the catalogue is tiny (~37 episodes), so it just
 * rides the normal Groq steady-state.
 */
export const tipMujrozhlasScraper = makeApiScraper({
  key: "tip-mujrozhlas",
  title: "Český rozhlas — Tip mujRozhlas",
  schedule: "49 2,8,14,20 * * *", // every 6h, staggered
  shows: [{ uuid: "7215c9c8-4d4a-3263-9c0b-f8aa6c310fd5", name: "Tip mujRozhlas" }],
});
