import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `jihoceska-vlastiveda` — "Jihočeská vlastivěda", Český rozhlas regional-history
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Jihočeská vlastivěda — 30f4aa0b-7dcc-3f8b-b532-37cea52c1831
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const jihoceskaVlastivedaScraper = makeApiScraper({
  key: "jihoceska-vlastiveda",
  title: "Český rozhlas — Jihočeská vlastivěda",
  schedule: "0 17 * * *", // nightly, offset from the other API sources
  shows: [{ uuid: "30f4aa0b-7dcc-3f8b-b532-37cea52c1831", name: "Jihočeská vlastivěda" }],
});
