import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `pribehy-z-vysociny` — "Příběhy z Vysočiny", Český rozhlas Vysočina regional
 * stories, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Příběhy z Vysočiny — a5715a4b-4509-33cb-bb64-584ab7b196ea
 *
 * Transcription ON (default): local whisper is disabled (WHISPER_PYTHON unset), so
 * nothing grinds the CPU — the whole back-catalogue is transcribed from the start by
 * the Groq backfill (which only picks sources with transcribe=true), paced by its rate.
 */
export const pribehyZVysocinyScraper = makeApiScraper({
  key: "pribehy-z-vysociny",
  title: "Český rozhlas Vysočina — Příběhy z Vysočiny",
  schedule: "13 4,10,16,22 * * *", // every 6h, staggered
  shows: [{ uuid: "a5715a4b-4509-33cb-bb64-584ab7b196ea", name: "Příběhy z Vysočiny" }],
});
