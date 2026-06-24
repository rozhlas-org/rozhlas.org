import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `akademie` — "Akademie", Český rozhlas Vltava thematic music-evening programme,
 * via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Akademie — 093f7f41-a78e-32ef-bc3a-573edb7ef308
 *
 * Transcription OFF for now: the one-time bulk back-catalogue is loaded without it
 * (avoids grinding the whole archive through whisper). We flip `transcribe` on later;
 * future episodes then transcribe normally while the already-loaded files stay un-transcribed.
 */
export const akademieScraper = makeApiScraper({
  key: "akademie",
  title: "Český rozhlas Vltava — Akademie",
  schedule: "13 1,7,13,19 * * *", // every 6h, staggered
  transcribe: false,
  shows: [{ uuid: "093f7f41-a78e-32ef-bc3a-573edb7ef308", name: "Akademie" }],
});
