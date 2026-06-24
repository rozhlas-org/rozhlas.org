import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `stredoceske-pribehy` — "Středočeské příběhy", Český rozhlas Střední Čechy regional
 * stories, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Středočeské příběhy — 11059c2f-f886-3966-9b8f-c8da37f0974e
 *
 * Transcription ON (default): local whisper is disabled (WHISPER_PYTHON unset), so
 * nothing grinds the CPU — the whole back-catalogue is transcribed from the start by
 * the Groq backfill (which only picks sources with transcribe=true), paced by its rate.
 */
export const stredoceskePribehyScraper = makeApiScraper({
  key: "stredoceske-pribehy",
  title: "Český rozhlas Střední Čechy — Středočeské příběhy",
  schedule: "25 0,6,12,18 * * *", // every 6h, staggered
  shows: [{ uuid: "11059c2f-f886-3966-9b8f-c8da37f0974e", name: "Středočeské příběhy" }],
});
