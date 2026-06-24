import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `pribehy-severoceskych-mest-a-obci` — "Příběhy severočeských měst a obcí", Český
 * rozhlas Sever local-history stories, via the mujRozhlas JSON:API. Single umbrella
 * show pinned by UUID.
 *   • Příběhy severočeských měst a obcí — be8c213b-88c2-3fa1-a453-b3e7daca9af7
 *
 * Transcription ON (default): local whisper is disabled (WHISPER_PYTHON unset), so
 * nothing grinds the CPU — the whole back-catalogue is transcribed from the start by
 * the Groq backfill (which only picks sources with transcribe=true), paced by its rate.
 */
export const pribehySeveroceskychMestAObciScraper = makeApiScraper({
  key: "pribehy-severoceskych-mest-a-obci",
  title: "Český rozhlas Sever — Příběhy severočeských měst a obcí",
  schedule: "13 5,11,17,23 * * *", // every 6h, staggered
  shows: [{ uuid: "be8c213b-88c2-3fa1-a453-b3e7daca9af7", name: "Příběhy severočeských měst a obcí" }],
});
