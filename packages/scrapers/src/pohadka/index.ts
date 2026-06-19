import { makeStationScraper } from "../station.ts";

/**
 * `pohadka` — Czech Radio fairy tales (pohádky). Dvojka hosts the two canonical
 * fairy-tale programmes, both built on the same station-site structure as cetba
 * (a hub listing reading pages with DASH audio per díl):
 *   • Hajaja  — the nightly bedtime fairy tale for children (since 1961)
 *   • Pohádka — the weekend dramatized fairy tale
 * Both are also mirrored on Rádio Junior; Dvojka is the fuller archive, so we
 * crawl it and let (sourceKey, sourceId) de-dupe any overlap.
 */
export const pohadkaScraper = makeStationScraper({
  key: "pohadka",
  title: "Český rozhlas — pohádky",
  schedule: "0 6 * * *", // nightly, offset from cetba (04:00) and wave (05:00)
  origin: "https://dvojka.rozhlas.cz",
  seeds: ["/hajaja-7230824", "/pohadka-7230814"],
  // Dvojka is a mixed station; the seeds ARE the two fairy-tale programmes, whose
  // episodes are linked directly. Depth 1 keeps us inside them — depth 2 would
  // follow links into unrelated Dvojka shows (music/talk) and ingest those.
  maxDepth: 1,
  delayMs: 500, // Dvojka throttles (403s) — crawl it more gently than other stations
});
