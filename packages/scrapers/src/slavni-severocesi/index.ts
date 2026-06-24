import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `slavni-severocesi` — "Slavní Severočeši", Český rozhlas Sever regional
 * biographies, via the mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Slavní Severočeši — c342c6c4-b000-3c22-a6f5-1a150fd13252
 *
 * Transcription ON (default): local whisper is disabled (WHISPER_PYTHON unset), so
 * nothing grinds the CPU — the whole back-catalogue is transcribed from the start by
 * the Groq backfill (which only picks sources with transcribe=true), paced by its rate.
 */
export const slavniSeverocesiScraper = makeApiScraper({
  key: "slavni-severocesi",
  title: "Český rozhlas Sever — Slavní Severočeši",
  schedule: "13 3,9,15,21 * * *", // every 6h, staggered
  shows: [{ uuid: "c342c6c4-b000-3c22-a6f5-1a150fd13252", name: "Slavní Severočeši" }],
});
