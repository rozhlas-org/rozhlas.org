import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `zednari` — "Zednáři", Český rozhlas documentary series, via the mujRozhlas
 * JSON:API. Single umbrella show pinned by UUID.
 *   • Zednáři — ba9611d0-c9c3-3d34-b684-525fccaa467c
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const zednariScraper = makeApiScraper({
  key: "zednari",
  title: "Český rozhlas — Zednáři",
  schedule: "0 16 * * *", // nightly, offset from the other API sources
  shows: [{ uuid: "ba9611d0-c9c3-3d34-b684-525fccaa467c", name: "Zednáři" }],
});
