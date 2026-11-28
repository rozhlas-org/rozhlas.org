import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `epsteinuv-ostrov` — "Epsteinův ostrov", Český rozhlas Plus. A finished
 * documentary podcast series on Jeffrey Epstein (E1–E6 + trailer + bonus, Nov 2026).
 * Single show, pinned by UUID (exact-title match):
 *   • Epsteinův ostrov — 93a6d09d-f71d-3d49-aee4-26f421abf585
 *
 * One-time import: no `schedule`, so no repeatable discover job is registered —
 * the source row is seeded on worker boot and the catalogue is loaded by a single
 * manually enqueued full `discover` run. Transcription on (default).
 */
export const epsteinuvOstrovScraper = makeApiScraper({
  key: "epsteinuv-ostrov",
  title: "Český rozhlas Plus — Epsteinův ostrov",
  shows: [{ uuid: "93a6d09d-f71d-3d49-aee4-26f421abf585", name: "Epsteinův ostrov" }],
});
