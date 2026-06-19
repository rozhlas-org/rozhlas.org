import { makeStationScraper } from "../station.ts";

/**
 * `cetba` — Český rozhlas Vltava literary hub (četba na pokračování, povídka,
 * osudy, drama…). Serialized readings with DASH audio per díl.
 */
export const cetbaScraper = makeStationScraper({
  key: "cetba",
  title: "Český rozhlas — četba a literatura",
  schedule: "0 4 * * *", // nightly
  origin: "https://vltava.rozhlas.cz",
  seeds: ["/hry-a-cetba"],
});
