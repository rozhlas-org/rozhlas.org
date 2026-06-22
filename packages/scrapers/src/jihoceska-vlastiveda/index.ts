import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `jihoceska-vlastiveda` — "Jihočeská vlastivěda", Český rozhlas regional-history
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Jihočeská vlastivěda — 30f4aa0b-7dcc-3f8b-b532-37cea52c1831
 *
 * `transcribe: false` for the one-time bulk load (large back-catalogue); on later.
 */
export const jihoceskaVlastivedaScraper = makeApiScraper({
  key: "jihoceska-vlastiveda",
  title: "Český rozhlas — Jihočeská vlastivěda",
  schedule: "0 17 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "30f4aa0b-7dcc-3f8b-b532-37cea52c1831", name: "Jihočeská vlastivěda" }],
});
