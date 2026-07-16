import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `letni-cteni` — "Letní čtení", Český rozhlas České Budějovice, via the mujRozhlas
 * JSON:API. A summer serialized-reading strand; single umbrella show pinned by UUID.
 *   • Letní čtení — 7e2de4df-bf19-3afd-a971-268983017d43
 *
 * Transcription on (default) — the back-catalogue is small (~13 episodes), so it
 * just rides the normal Groq steady-state.
 */
export const letniCteniScraper = makeApiScraper({
  key: "letni-cteni",
  title: "Český rozhlas Budějovice — Letní čtení",
  schedule: "31 5,11,17,23 * * *", // every 6h, staggered
  shows: [{ uuid: "7e2de4df-bf19-3afd-a971-268983017d43", name: "Letní čtení" }],
});
