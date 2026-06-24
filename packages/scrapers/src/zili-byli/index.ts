import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `zili-byli` — "ŽiliByli", Český rozhlas programme, via the mujRozhlas JSON:API.
 * Single umbrella show pinned by UUID.
 *   • ŽiliByli — ea4fec1c-f095-3ab7-8630-aab6aedeeb4a
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const ziliByliScraper = makeApiScraper({
  key: "zili-byli",
  title: "Český rozhlas — ŽiliByli",
  schedule: "31 3,9,15,21 * * *", // every 6h, staggered
  shows: [{ uuid: "ea4fec1c-f095-3ab7-8630-aab6aedeeb4a", name: "ŽiliByli" }],
});
