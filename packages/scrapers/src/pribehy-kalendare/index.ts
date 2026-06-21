import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `pribehy-kalendare` — "Příběhy z kalendáře", Český rozhlas history/anniversary
 * miniatures, via the mujRozhlas JSON:API. Single umbrella show, pinned by UUID
 * (resolved from `/shows?filter[title][eq]=Příběhy z kalendáře`):
 *   • Příběhy z kalendáře — 03f669b2-150c-31f0-bba2-9f08d46995da
 *
 * Transcription is on (default): the one-time bulk back-catalogue was loaded with
 * it off; now future episodes transcribe normally. The already-loaded files stay
 * un-transcribed (only a deliberate backfill would pick them up).
 */
export const pribehyKalendareScraper = makeApiScraper({
  key: "pribehy-kalendare",
  title: "Český rozhlas — Příběhy z kalendáře",
  schedule: "0 10 * * *", // nightly, offset from the other API sources
  shows: [{ uuid: "03f669b2-150c-31f0-bba2-9f08d46995da", name: "Příběhy z kalendáře" }],
});
