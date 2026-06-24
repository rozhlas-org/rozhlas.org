import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `toulky-prvni-republikou` — "Toulky první republikou", Český rozhlas history
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Toulky první republikou — 8e6624c4-c26d-3e41-a990-c159e6302a63
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const toulkyPrvniRepublikouScraper = makeApiScraper({
  key: "toulky-prvni-republikou",
  title: "Český rozhlas — Toulky první republikou",
  schedule: "31 2,8,14,20 * * *", // every 6h, staggered
  shows: [{ uuid: "8e6624c4-c26d-3e41-a990-c159e6302a63", name: "Toulky první republikou" }],
});
