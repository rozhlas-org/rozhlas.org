import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `setkani-s-literaturou` — "Setkání s literaturou", Český rozhlas literary
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Setkání s literaturou — 9aec0249-3f85-3b42-8d7e-b8e8a3c76e39
 *
 * `transcribe: false` for the one-time bulk load; flipped on later.
 */
export const setkaniSLiteraturouScraper = makeApiScraper({
  key: "setkani-s-literaturou",
  title: "Český rozhlas — Setkání s literaturou",
  schedule: "0 22 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "9aec0249-3f85-3b42-8d7e-b8e8a3c76e39", name: "Setkání s literaturou" }],
});
