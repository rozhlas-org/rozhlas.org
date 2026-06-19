import { makeStationScraper } from "../station.ts";

/**
 * `junior-pribehy` — Rádio Junior's "Příběhy a pohádky" hub: serialized stories
 * (Čtení na pokračování) and fairy tales (Malá/Velká pohádka, …), same station-site
 * structure as cetba.
 *
 * Overlap note: ~a third of these episodes also air on Dvojka and carry the SAME
 * rozhlas node-id, so they collide with the `pohadka` source. upsertShow's
 * cross-source dedup skips any reading whose id already exists under another
 * source — so the Dvojka `pohadka` source keeps the mirrors and we scrape only
 * Junior's unique content here.
 */
export const juniorPribehyScraper = makeStationScraper({
  key: "junior-pribehy",
  title: "Rádio Junior — příběhy a pohádky",
  schedule: "0 7 * * *", // nightly, offset from cetba (04), wave (05), pohadka (06)
  origin: "https://junior.rozhlas.cz",
  seeds: ["/pribehy"],
});
