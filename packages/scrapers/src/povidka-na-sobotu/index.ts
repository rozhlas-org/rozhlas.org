import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `povidka-na-sobotu` — "Povídka na sobotu", Český rozhlas short stories by
 * regional authors, via the mujRozhlas JSON:API. Single umbrella show pinned by
 * UUID.
 *   • Povídka na sobotu — 49e08d0e-f6f3-3af2-ae51-ae1fb76083c8
 *
 * Transcription ON (default): local whisper is disabled (WHISPER_PYTHON unset), so
 * nothing grinds the CPU — the whole back-catalogue is transcribed from the start by
 * the Groq backfill (which only picks sources with transcribe=true), paced by its rate.
 */
export const povidkaNaSobotuScraper = makeApiScraper({
  key: "povidka-na-sobotu",
  title: "Český rozhlas — Povídka na sobotu",
  schedule: "25 4,10,16,22 * * *", // every 6h, staggered
  shows: [{ uuid: "49e08d0e-f6f3-3af2-ae51-ae1fb76083c8", name: "Povídka na sobotu" }],
});
