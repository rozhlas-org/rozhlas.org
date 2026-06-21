import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `hra-na-nedeli` — "Hra na neděli", Český rozhlas Sunday radio drama, via the
 * mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Hra na neděli — 0e65e92d-3eb9-329a-8b35-86d9b7e1ce76
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const hraNaNedeliScraper = makeApiScraper({
  key: "hra-na-nedeli",
  title: "Český rozhlas — Hra na neděli",
  schedule: "0 12 * * *", // nightly, offset from the other API sources
  shows: [{ uuid: "0e65e92d-3eb9-329a-8b35-86d9b7e1ce76", name: "Hra na neděli" }],
});
