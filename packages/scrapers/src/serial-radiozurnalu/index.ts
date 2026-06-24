import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `serial-radiozurnalu` — "Seriál Radiožurnálu", Český rozhlas Radiožurnál
 * documentary-series programme, via the mujRozhlas JSON:API. Single umbrella show
 * pinned by UUID.
 *   • Seriál Radiožurnálu — 816732b1-04cc-3f40-972a-ba16bf5a6eb1
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const serialRadiozurnaluScraper = makeApiScraper({
  key: "serial-radiozurnalu",
  title: "Český rozhlas Radiožurnál — Seriál Radiožurnálu",
  schedule: "55 0,6,12,18 * * *", // every 6h, staggered
  shows: [{ uuid: "816732b1-04cc-3f40-972a-ba16bf5a6eb1", name: "Seriál Radiožurnálu" }],
});
