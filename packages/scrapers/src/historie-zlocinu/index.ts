import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `historie-zlocinu` — "Historie českého zločinu", Český rozhlas true-crime
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Historie českého zločinu — c9395a54-f2db-3013-8d5b-94bbc38617ce
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const historieZlocinuScraper = makeApiScraper({
  key: "historie-zlocinu",
  title: "Český rozhlas — Historie českého zločinu",
  schedule: "0 15 * * *", // nightly, offset from the other API sources
  shows: [{ uuid: "c9395a54-f2db-3013-8d5b-94bbc38617ce", name: "Historie českého zločinu" }],
});
