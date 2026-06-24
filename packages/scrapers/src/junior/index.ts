import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `junior-pribehy` — Rádio Junior's "Příběhy a pohádky" hub (serialized stories +
 * fairy tales). A category hub (no single show UUID), so we enumerate its shows
 * from the hub page, then read episodes from the mujRozhlas JSON:API.
 *
 * Overlap with `pohadka` (Dvojka mirrors) de-dupes natively: both sources are now in
 * the UUID namespace, so a shared serial/episode UUID is skipped by upsertShow's
 * cross-source mirror check.
 */
export const juniorPribehyScraper = makeApiScraper({
  key: "junior-pribehy",
  title: "Rádio Junior — příběhy a pohádky",
  schedule: "7 2,8,14,20 * * *", // every 6h, staggered
  hub: { origin: "https://junior.rozhlas.cz", seeds: ["/pribehy"] },
});
