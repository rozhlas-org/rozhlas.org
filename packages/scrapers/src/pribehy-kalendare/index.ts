import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `pribehy-kalendare` — "Příběhy z kalendáře", Český rozhlas history/anniversary
 * miniatures, via the mujRozhlas JSON:API. Single umbrella show, pinned by UUID
 * (resolved from `/shows?filter[title][eq]=Příběhy z kalendáře`):
 *   • Příběhy z kalendáře — 03f669b2-150c-31f0-bba2-9f08d46995da
 *
 * `transcribe: false` — large back-catalogue, transcription deferred for now.
 */
export const pribehyKalendareScraper = makeApiScraper({
  key: "pribehy-kalendare",
  title: "Český rozhlas — Příběhy z kalendáře",
  schedule: "0 10 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "03f669b2-150c-31f0-bba2-9f08d46995da", name: "Příběhy z kalendáře" }],
});
