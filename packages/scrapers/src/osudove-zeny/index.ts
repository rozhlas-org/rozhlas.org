import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `osudove-zeny` — "Osudové ženy", Český rozhlas biographical programme, via the
 * mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Osudové ženy — e69d38d3-5b96-3692-8bd9-cf42fa93a2a8
 *
 * `transcribe: false` for the one-time bulk load (large back-catalogue); on later.
 */
export const osudoveZenyScraper = makeApiScraper({
  key: "osudove-zeny",
  title: "Český rozhlas — Osudové ženy",
  schedule: "0 14 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "e69d38d3-5b96-3692-8bd9-cf42fa93a2a8", name: "Osudové ženy" }],
});
