import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `rozhlasova-hra` — "Rozhlasová hra", Český rozhlas Dvojka. Traditional radio
 * drama, pinned by its Dvojka umbrella show UUID (the most-frequent UUID on the
 * dvojka.rozhlas.cz pořad page; distinct from the Rádio Junior "Rozhlasová hra"
 * that the junior-pribehy hub already enumerates — verified none of this show's
 * episodes are ingested yet):
 *   • Rozhlasová hra (Dvojka) — cb27b0d5-ee87-3b66-81cc-093faf3afb98
 *
 * Fetched from the mujRozhlas JSON:API (not the throttled Dvojka HTML), so no
 * rate-limit concerns. Transcription on (default) — small catalogue, rides the
 * Groq steady-state.
 */
export const rozhlasovaHraScraper = makeApiScraper({
  key: "rozhlasova-hra",
  title: "Český rozhlas Dvojka — Rozhlasová hra",
  schedule: "51 1,7,13,19 * * *", // every 6h, staggered
  shows: [{ uuid: "cb27b0d5-ee87-3b66-81cc-093faf3afb98", name: "Rozhlasová hra" }],
});
