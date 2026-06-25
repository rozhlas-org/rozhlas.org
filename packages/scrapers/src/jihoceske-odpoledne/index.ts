import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `jihoceske-odpoledne` — "Jihočeské odpoledne", Český rozhlas České Budějovice
 * afternoon regional radio stream, via the mujRozhlas JSON:API. Single umbrella
 * show pinned by UUID.
 *   • Jihočeské odpoledne — 550d90d6-98fd-351d-8398-2dc9eca7fd54
 *
 * Transcription ON (default): local whisper is disabled (WHISPER_PYTHON unset), so
 * nothing grinds the CPU — the whole back-catalogue is transcribed from the start by
 * the Groq backfill (which only picks sources with transcribe=true), paced by its rate.
 */
export const jihoceskeOdpoledneScraper = makeApiScraper({
  key: "jihoceske-odpoledne",
  title: "Český rozhlas České Budějovice — Jihočeské odpoledne",
  schedule: "25 2,8,14,20 * * *", // every 6h, staggered
  shows: [{ uuid: "550d90d6-98fd-351d-8398-2dc9eca7fd54", name: "Jihočeské odpoledne" }],
});
