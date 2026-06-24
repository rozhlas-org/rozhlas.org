import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `co-v-ucebnicich-nebylo` — "Co v učebnicích nebylo", Český rozhlas history
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Co v učebnicích nebylo — 7007c8c1-bded-3710-ad67-d12c5b188bd1
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const coVUcebnicichNebyloScraper = makeApiScraper({
  key: "co-v-ucebnicich-nebylo",
  title: "Český rozhlas — Co v učebnicích nebylo",
  schedule: "31 4,10,16,22 * * *", // every 6h, staggered
  shows: [{ uuid: "7007c8c1-bded-3710-ad67-d12c5b188bd1", name: "Co v učebnicích nebylo" }],
});
