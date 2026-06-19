import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `cetba` — Český rozhlas Vltava literary hub (četba na pokračování, povídka,
 * osudy, drama…). A category hub with many programmes, so we enumerate its shows
 * from the Vltava hub page, then read episodes from the mujRozhlas JSON:API
 * (Vltava doesn't throttle like Dvojka, and the API gives the full archive cheaply).
 */
export const cetbaScraper = makeApiScraper({
  key: "cetba",
  title: "Český rozhlas — četba a literatura",
  schedule: "0 4 * * *", // nightly
  hub: { origin: "https://vltava.rozhlas.cz", seeds: ["/hry-a-cetba"] },
});
