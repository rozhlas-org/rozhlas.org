import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `stopy-fakta-tajemstvi` — "Stopy, fakta, tajemství...", Český rozhlas Dvojka.
 * Stanislav Motl's historical investigations (archive digging, forgotten fates,
 * wartime mysteries — e.g. K. H. Frank's escape from Prague). Single umbrella show,
 * pinned by UUID (exact-title match; both dvojka.rozhlas.cz pořad pages point to it):
 *   • Stopy, fakta, tajemství... — a9cd588d-64eb-3628-bef1-4d30840e83dc
 *
 * Standalone weekly episodes (no serials); the API exposes ~18 back to 2010.
 * Transcription on (default) — small catalogue, rides the Groq steady-state.
 */
export const stopyFaktaTajemstviScraper = makeApiScraper({
  key: "stopy-fakta-tajemstvi",
  title: "Český rozhlas Dvojka — Stopy, fakta, tajemství...",
  schedule: "27 3,9,15,21 * * *", // every 6h, staggered
  shows: [{ uuid: "a9cd588d-64eb-3628-bef1-4d30840e83dc", name: "Stopy, fakta, tajemství..." }],
});
