import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `osudove-zeny` — "Osudové ženy", Český rozhlas biographical programme, via the
 * mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Osudové ženy — e69d38d3-5b96-3692-8bd9-cf42fa93a2a8
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const osudoveZenyScraper = makeApiScraper({
  key: "osudove-zeny",
  title: "Český rozhlas — Osudové ženy",
  schedule: "0 14 * * *", // nightly, offset from the other API sources
  shows: [{ uuid: "e69d38d3-5b96-3692-8bd9-cf42fa93a2a8", name: "Osudové ženy" }],
});
