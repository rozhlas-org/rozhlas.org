import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `hra-na-nedeli` — "Hra na neděli", Český rozhlas Sunday radio drama, via the
 * mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Hra na neděli — 0e65e92d-3eb9-329a-8b35-86d9b7e1ce76
 *
 * `transcribe: false` for the one-time bulk load; flipped on later (see #59).
 */
export const hraNaNedeliScraper = makeApiScraper({
  key: "hra-na-nedeli",
  title: "Český rozhlas — Hra na neděli",
  schedule: "0 12 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "0e65e92d-3eb9-329a-8b35-86d9b7e1ce76", name: "Hra na neděli" }],
});
