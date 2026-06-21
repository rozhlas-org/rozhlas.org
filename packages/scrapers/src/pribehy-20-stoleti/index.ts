import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `pribehy-20-stoleti` — "Příběhy 20. století", Český rozhlas oral-history
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Příběhy 20. století — d200d0b5-78d5-3cca-9052-834f13135225
 *
 * `transcribe: false` for the one-time bulk load (large back-catalogue); on later.
 */
export const pribehy20StoletiScraper = makeApiScraper({
  key: "pribehy-20-stoleti",
  title: "Český rozhlas — Příběhy 20. století",
  schedule: "0 13 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "d200d0b5-78d5-3cca-9052-834f13135225", name: "Příběhy 20. století" }],
});
