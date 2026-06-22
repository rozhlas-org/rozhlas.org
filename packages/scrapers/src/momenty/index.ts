import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `momenty` — "Momenty", Český rozhlas programme, via the mujRozhlas JSON:API.
 * Single umbrella show pinned by UUID.
 *   • Momenty — 60c3a92e-0efe-315e-93c7-3d2e0a2c4996
 *
 * `transcribe: false` for the one-time bulk load; flipped on later.
 */
export const momentyScraper = makeApiScraper({
  key: "momenty",
  title: "Český rozhlas — Momenty",
  schedule: "30 6 * * *", // nightly; :30 offset (the hourly slots are taken)
  transcribe: false,
  shows: [{ uuid: "60c3a92e-0efe-315e-93c7-3d2e0a2c4996", name: "Momenty" }],
});
