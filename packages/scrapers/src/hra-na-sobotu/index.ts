import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `hra-na-sobotu` — "Hra na sobotu", Český rozhlas Saturday radio drama, via the
 * mujRozhlas JSON:API. Single umbrella show, pinned by UUID (resolved from
 * `/shows?filter[title][eq]=Hra na sobotu`):
 *   • Hra na sobotu — fb9e66b6-83fa-3c73-88b7-449b22078af6
 *
 * Transcription on (default). Small catalogue (~8 episodes), so the initial load
 * is transcribed automatically as each file becomes streamable — no separate
 * backfill needed.
 */
export const hraNaSobotuScraper = makeApiScraper({
  key: "hra-na-sobotu",
  title: "Český rozhlas — Hra na sobotu",
  schedule: "0 11 * * *", // nightly, offset from the other API sources
  shows: [{ uuid: "fb9e66b6-83fa-3c73-88b7-449b22078af6", name: "Hra na sobotu" }],
});
