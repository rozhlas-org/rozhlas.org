import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `pribehy-20-stoleti` — "Příběhy 20. století", Český rozhlas oral-history
 * programme, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Příběhy 20. století — d200d0b5-78d5-3cca-9052-834f13135225
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const pribehy20StoletiScraper = makeApiScraper({
  key: "pribehy-20-stoleti",
  title: "Český rozhlas — Příběhy 20. století",
  schedule: "0 13 * * *", // nightly, offset from the other API sources
  shows: [{ uuid: "d200d0b5-78d5-3cca-9052-834f13135225", name: "Příběhy 20. století" }],
});
