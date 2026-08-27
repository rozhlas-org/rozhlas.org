import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `pokracovani-za-pet-minut` — "Pokračování za pět minut", Český rozhlas Vltava.
 * Summer-evening literary readings of assorted texts set to music ("Letní večery
 * s texty nejrůznější povahy doprovázené hudbou"). Single umbrella show pinned by
 * UUID; each episode is a standalone reading.
 *   • Pokračování za pět minut — 0038fee4-b218-3a73-a4a4-04544f431aad
 *
 * Transcription on (default) — tiny catalogue (~8 episodes), rides the Groq
 * steady-state.
 */
export const pokracovaniZaPetMinutScraper = makeApiScraper({
  key: "pokracovani-za-pet-minut",
  title: "Český rozhlas Vltava — Pokračování za pět minut",
  schedule: "37 0,6,12,18 * * *", // every 6h, staggered
  shows: [{ uuid: "0038fee4-b218-3a73-a4a4-04544f431aad", name: "Pokračování za pět minut" }],
});
