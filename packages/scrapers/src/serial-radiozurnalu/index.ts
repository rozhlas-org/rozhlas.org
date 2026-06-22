import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `serial-radiozurnalu` — "Seriál Radiožurnálu", Český rozhlas Radiožurnál
 * documentary-series programme, via the mujRozhlas JSON:API. Single umbrella show
 * pinned by UUID.
 *   • Seriál Radiožurnálu — 816732b1-04cc-3f40-972a-ba16bf5a6eb1
 *
 * `transcribe: false` for the one-time bulk load (large ~1970-episode back-catalogue);
 * flipped on later.
 */
export const serialRadiozurnaluScraper = makeApiScraper({
  key: "serial-radiozurnalu",
  title: "Český rozhlas Radiožurnál — Seriál Radiožurnálu",
  schedule: "30 9 * * *", // nightly; :30 offset (the hourly slots are taken)
  transcribe: false,
  shows: [{ uuid: "816732b1-04cc-3f40-972a-ba16bf5a6eb1", name: "Seriál Radiožurnálu" }],
});
