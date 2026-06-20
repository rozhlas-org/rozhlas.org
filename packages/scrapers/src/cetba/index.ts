import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `cetba` — Český rozhlas literary readings (četba na pokračování, povídka, osudy,
 * drama…). Most are reachable by enumerating the Vltava `/hry-a-cetba` hub, but some
 * cross-station umbrella programmes aren't linked there (e.g. the Dvojka-hosted
 * "Četba na pokračování" show, which carries serials like *Žluté oči vedou domů*),
 * so we pin those by UUID alongside the hub crawl.
 */
export const cetbaScraper = makeApiScraper({
  key: "cetba",
  title: "Český rozhlas — četba a literatura",
  schedule: "0 4 * * *", // nightly
  hub: { origin: "https://vltava.rozhlas.cz", seeds: ["/hry-a-cetba"] },
  shows: [
    { uuid: "be39d135-9e67-36c0-9d56-7e900c39cc8f", name: "Četba na pokračování" },
  ],
});
