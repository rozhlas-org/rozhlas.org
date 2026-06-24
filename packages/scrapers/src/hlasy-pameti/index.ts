import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `hlasy-pameti` — "Hlasy paměti", Český rozhlas Plus documentary podcast about
 * the 20th century, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Hlasy paměti — ccb2d6ca-197a-3e19-a8da-f3bb33c5616f
 *
 * Transcription OFF for now: the one-time bulk back-catalogue is loaded without it
 * (avoids grinding the whole archive through whisper). We flip `transcribe` on later;
 * future episodes then transcribe normally while the already-loaded files stay un-transcribed.
 */
export const hlasyPametiScraper = makeApiScraper({
  key: "hlasy-pameti",
  title: "Český rozhlas Plus — Hlasy paměti",
  schedule: "13 0,6,12,18 * * *", // every 6h, staggered
  transcribe: false,
  shows: [{ uuid: "ccb2d6ca-197a-3e19-a8da-f3bb33c5616f", name: "Hlasy paměti" }],
});
