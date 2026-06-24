import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `nedelni-vlna-pardubice` — "Na nedělní vlně z Pardubic", Český rozhlas regional
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Na nedělní vlně z Pardubic — e610e384-02ba-3b35-99b9-bcc23d4ad1a9
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const nedelniVlnaPardubiceScraper = makeApiScraper({
  key: "nedelni-vlna-pardubice",
  title: "Český rozhlas — Na nedělní vlně z Pardubic",
  schedule: "43 0,6,12,18 * * *", // every 6h, staggered
  shows: [{ uuid: "e610e384-02ba-3b35-99b9-bcc23d4ad1a9", name: "Na nedělní vlně z Pardubic" }],
});
