import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `zili-byli` — "ŽiliByli", Český rozhlas programme, via the mujRozhlas JSON:API.
 * Single umbrella show pinned by UUID.
 *   • ŽiliByli — ea4fec1c-f095-3ab7-8630-aab6aedeeb4a
 *
 * `transcribe: false` for the one-time bulk load; flipped on later.
 */
export const ziliByliScraper = makeApiScraper({
  key: "zili-byli",
  title: "Český rozhlas — ŽiliByli",
  schedule: "0 20 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "ea4fec1c-f095-3ab7-8630-aab6aedeeb4a", name: "ŽiliByli" }],
});
