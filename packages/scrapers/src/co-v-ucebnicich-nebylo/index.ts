import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `co-v-ucebnicich-nebylo` — "Co v učebnicích nebylo", Český rozhlas history
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Co v učebnicích nebylo — 7007c8c1-bded-3710-ad67-d12c5b188bd1
 *
 * `transcribe: false` for the one-time bulk load; flipped on later.
 */
export const coVUcebnicichNebyloScraper = makeApiScraper({
  key: "co-v-ucebnicich-nebylo",
  title: "Český rozhlas — Co v učebnicích nebylo",
  schedule: "0 21 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "7007c8c1-bded-3710-ad67-d12c5b188bd1", name: "Co v učebnicích nebylo" }],
});
