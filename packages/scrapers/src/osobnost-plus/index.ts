import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `osobnost-plus` — "Osobnost Plus", Český rozhlas Plus interview programme, via
 * the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Osobnost Plus — ad21758a-b517-328e-9bb0-2a2e2819f0b5
 *
 * `transcribe: false` for the one-time bulk load (large ~1.9k-episode back-catalogue);
 * flipped on later.
 */
export const osobnostPlusScraper = makeApiScraper({
  key: "osobnost-plus",
  title: "Český rozhlas Plus — Osobnost Plus",
  schedule: "30 8 * * *", // nightly; :30 offset (the hourly slots are taken)
  transcribe: false,
  shows: [{ uuid: "ad21758a-b517-328e-9bb0-2a2e2819f0b5", name: "Osobnost Plus" }],
});
