import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `koreny-jihocesti` — "Kořeny – Z dějin jihočeských rodin a rodů", Český rozhlas
 * České Budějovice regional family-history programme, via the mujRozhlas JSON:API.
 * Single umbrella show pinned by UUID. Distinct from `koreny` (the Zlín-region show).
 *   • Kořeny – Z dějin jihočeských rodin a rodů — 02392c1d-77df-30f8-aa29-e530e9b47ac0
 *
 * Transcription ON (default): local whisper is disabled (WHISPER_PYTHON unset), so
 * nothing grinds the CPU — the whole back-catalogue is transcribed from the start by
 * the Groq backfill (which only picks sources with transcribe=true), paced by its rate.
 */
export const korenyJihocestiScraper = makeApiScraper({
  key: "koreny-jihocesti",
  title: "Český rozhlas České Budějovice — Kořeny – Z dějin jihočeských rodin a rodů",
  schedule: "25 3,9,15,21 * * *", // every 6h, staggered
  shows: [{ uuid: "02392c1d-77df-30f8-aa29-e530e9b47ac0", name: "Kořeny – Z dějin jihočeských rodin a rodů" }],
});
