import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `toulky-prvni-republikou` — "Toulky první republikou", Český rozhlas history
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Toulky první republikou — 8e6624c4-c26d-3e41-a990-c159e6302a63
 *
 * `transcribe: false` for the one-time bulk load; flipped on later.
 */
export const toulkyPrvniRepublikouScraper = makeApiScraper({
  key: "toulky-prvni-republikou",
  title: "Český rozhlas — Toulky první republikou",
  schedule: "0 19 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "8e6624c4-c26d-3e41-a990-c159e6302a63", name: "Toulky první republikou" }],
});
