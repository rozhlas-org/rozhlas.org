import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `momenty` — "Momenty", Český rozhlas programme, via the mujRozhlas JSON:API.
 * Single umbrella show pinned by UUID.
 *   • Momenty — 60c3a92e-0efe-315e-93c7-3d2e0a2c4996
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const momentyScraper = makeApiScraper({
  key: "momenty",
  title: "Český rozhlas — Momenty",
  schedule: "43 3,9,15,21 * * *", // every 6h, staggered
  shows: [{ uuid: "60c3a92e-0efe-315e-93c7-3d2e0a2c4996", name: "Momenty" }],
});
