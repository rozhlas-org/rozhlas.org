import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `vylety` — "Výlety", Český rozhlas travel/regional programme, via the mujRozhlas
 * JSON:API. Single umbrella show pinned by UUID.
 *   • Výlety — c276b22a-06b4-396b-8ab4-e16fc6fa4991
 *
 * `transcribe: false` for the one-time bulk load (large ~2k-episode back-catalogue);
 * flipped on later.
 */
export const vyletyScraper = makeApiScraper({
  key: "vylety",
  title: "Český rozhlas — Výlety",
  schedule: "30 4 * * *", // nightly; :30 offset (the hourly slots are taken)
  transcribe: false,
  shows: [{ uuid: "c276b22a-06b4-396b-8ab4-e16fc6fa4991", name: "Výlety" }],
});
