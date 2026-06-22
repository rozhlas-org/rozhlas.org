import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `praha-je-nej` — "Praha je NEJ!", Český rozhlas Prague programme, via the
 * mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Praha je NEJ! — ddcbb7ac-5f52-3992-8d15-78e9389473bc
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const prahaJeNejScraper = makeApiScraper({
  key: "praha-je-nej",
  title: "Český rozhlas — Praha je NEJ!",
  schedule: "30 5 * * *", // nightly; :30 offset (the hourly slots are taken)
  shows: [{ uuid: "ddcbb7ac-5f52-3992-8d15-78e9389473bc", name: "Praha je NEJ!" }],
});
