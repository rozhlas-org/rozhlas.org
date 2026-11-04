import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `dokument-plus` — "Dokument Plus", Český rozhlas Plus.
 *
 * Weekly documentary slot ("Současnost ve zvukové stopě") — present-day stories and
 * phenomena told by documentarists. Pinned by UUID:
 *   • Dokument Plus — b8c2564a-1dac-3230-8949-1aad7fd7688a
 *
 * The API exposes ~337 episodes back to 2017: mostly standalone, plus ~43 docuseries
 * serials (grouped into one show each). Transcription on (default).
 */
export const dokumentPlusScraper = makeApiScraper({
  key: "dokument-plus",
  title: "Český rozhlas Plus — Dokument Plus",
  schedule: "33 2,8,14,20 * * *", // every 6h, staggered
  shows: [{ uuid: "b8c2564a-1dac-3230-8949-1aad7fd7688a", name: "Dokument Plus" }],
});
