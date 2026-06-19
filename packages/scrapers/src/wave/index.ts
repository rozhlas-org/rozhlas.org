import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `wave-audiobooks` — Audioknihy Radia Wave (full audiobooks), via the mujRozhlas
 * JSON:API. It's a single programme show (UUID embedded in the Wave hub page), so
 * we read its episodes directly from the API (full archive, no HTML crawling).
 *   • Audioknihy Radia Wave — 0226cb25-8ea1-3adc-b3e5-f7fc4fee5774
 */
export const waveAudiobooksScraper = makeApiScraper({
  key: "wave-audiobooks",
  title: "Audioknihy Radia Wave",
  schedule: "0 5 * * *", // nightly (offset from cetba)
  shows: [{ uuid: "0226cb25-8ea1-3adc-b3e5-f7fc4fee5774", name: "Audioknihy Radia Wave" }],
});
