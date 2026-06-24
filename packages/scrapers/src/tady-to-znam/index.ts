import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `tady-to-znam` — "Tady to znám", Český rozhlas regional programme, via the
 * mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Tady to znám — e4ced81f-0f6a-3594-9fe4-fc531bb2b28d
 *
 * Transcription on (default): the one-time bulk back-catalogue was loaded with it
 * off; future episodes transcribe normally (already-loaded files stay un-transcribed).
 */
export const tadyToZnamScraper = makeApiScraper({
  key: "tady-to-znam",
  title: "Český rozhlas — Tady to znám",
  schedule: "31 1,7,13,19 * * *", // every 6h, staggered
  shows: [{ uuid: "e4ced81f-0f6a-3594-9fe4-fc531bb2b28d", name: "Tady to znám" }],
});
