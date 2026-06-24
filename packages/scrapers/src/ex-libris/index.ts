import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `ex-libris` — "Ex libris", Český rozhlas Plus books programme (notable people
 * recommend books), via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Ex libris — cfcec499-8ae5-3338-8ea8-216d32e24da8
 *
 * Transcription OFF for now: the one-time bulk back-catalogue is loaded without it
 * (avoids grinding the whole archive through whisper). We flip `transcribe` on later;
 * future episodes then transcribe normally while the already-loaded files stay un-transcribed.
 */
export const exLibrisScraper = makeApiScraper({
  key: "ex-libris",
  title: "Český rozhlas Plus — Ex libris",
  schedule: "13 2,8,14,20 * * *", // every 6h, staggered
  transcribe: false,
  shows: [{ uuid: "cfcec499-8ae5-3338-8ea8-216d32e24da8", name: "Ex libris" }],
});
