import { makeStationScraper } from "../station.ts";

/**
 * `wave-audiobooks` — Audioknihy Radia Wave (full audiobooks). Same station-site
 * structure as cetba: a hub listing reading pages with DASH audio per díl.
 */
export const waveAudiobooksScraper = makeStationScraper({
  key: "wave-audiobooks",
  title: "Audioknihy Radia Wave",
  schedule: "0 5 * * *", // nightly (offset from cetba)
  origin: "https://wave.rozhlas.cz",
  seeds: ["/audioknihy-radia-wave-9166009"],
  maxDepth: 1, // curated hub links the audiobooks directly — don't wander into Wave news
});
