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
  // Cross-station umbrella programmes the Vltava hub doesn't link — pinned by UUID.
  shows: [
    { uuid: "be39d135-9e67-36c0-9d56-7e900c39cc8f", name: "Četba na pokračování" },
    { uuid: "9c1921eb-804c-3d21-a96f-f2405e2ddc56", name: "Radiokniha" },
    { uuid: "ec0cc279-ba06-3403-b9c5-c8d7172f0887", name: "Návraty časem" },
    { uuid: "97e4e533-1cf0-3bbb-8026-c3e22ff82ad0", name: "Toulky českou minulostí" },
    { uuid: "d6f374ee-6da0-3604-b973-aadc303daa43", name: "Středočeská mozaika" },
  ],
});
