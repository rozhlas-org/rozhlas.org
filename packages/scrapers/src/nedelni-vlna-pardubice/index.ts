import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `nedelni-vlna-pardubice` — "Na nedělní vlně z Pardubic", Český rozhlas regional
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Na nedělní vlně z Pardubic — e610e384-02ba-3b35-99b9-bcc23d4ad1a9
 *
 * `transcribe: false` for the one-time bulk load (large back-catalogue); on later.
 */
export const nedelniVlnaPardubiceScraper = makeApiScraper({
  key: "nedelni-vlna-pardubice",
  title: "Český rozhlas — Na nedělní vlně z Pardubic",
  schedule: "0 23 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "e610e384-02ba-3b35-99b9-bcc23d4ad1a9", name: "Na nedělní vlně z Pardubic" }],
});
