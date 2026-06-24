import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `vylety` — "Výlety", Český rozhlas travel/regional programme, via the mujRozhlas
 * JSON:API. Single umbrella show pinned by UUID.
 *   • Výlety — c276b22a-06b4-396b-8ab4-e16fc6fa4991
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const vyletyScraper = makeApiScraper({
  key: "vylety",
  title: "Český rozhlas — Výlety",
  schedule: "43 1,7,13,19 * * *", // every 6h, staggered
  shows: [{ uuid: "c276b22a-06b4-396b-8ab4-e16fc6fa4991", name: "Výlety" }],
});
