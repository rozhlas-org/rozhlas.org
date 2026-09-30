import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `betonovy-lidi` — "Vladimir 518: Betonový lidi", Český rozhlas Vltava. A
 * documentary series on the thinking that shaped Czech housing estates (sídliště)
 * and the culture that grew on them. Pinned by its umbrella show UUID:
 *   • Vladimir 518: Betonový lidi — c495bea4-3d0b-3fb7-895f-3fdb01828bfb
 *
 * Still airing: the serial under this show declares 12 parts but only the intro +
 * parts 1–4 have aired (weekly). Pinning the show — rather than the serial — means
 * the scheduled run picks up each new part as it lands, plus any standalone
 * episodes the serial doesn't cover (e.g. the intro).
 *
 * Transcription on (default) — small catalogue, rides the Groq steady-state.
 */
export const betonovyLidiScraper = makeApiScraper({
  key: "betonovy-lidi",
  title: "Český rozhlas Vltava — Vladimir 518: Betonový lidi",
  schedule: "21 1,7,13,19 * * *", // every 6h, staggered
  shows: [{ uuid: "c495bea4-3d0b-3fb7-895f-3fdb01828bfb", name: "Vladimir 518: Betonový lidi" }],
});
