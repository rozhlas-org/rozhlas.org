import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `koreny` — "Kořeny", Český rozhlas programme, via the mujRozhlas JSON:API.
 * Single umbrella show pinned by UUID.
 *   • Kořeny — df2ace96-2fd0-3a48-ac66-2d0164353124
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const korenyScraper = makeApiScraper({
  key: "koreny",
  title: "Český rozhlas — Kořeny",
  schedule: "30 7 * * *", // nightly; :30 offset (the hourly slots are taken)
  shows: [{ uuid: "df2ace96-2fd0-3a48-ac66-2d0164353124", name: "Kořeny" }],
});
