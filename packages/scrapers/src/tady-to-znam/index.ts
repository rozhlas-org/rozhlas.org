import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `tady-to-znam` — "Tady to znám", Český rozhlas regional programme, via the
 * mujRozhlas JSON:API. Single umbrella show pinned by UUID.
 *   • Tady to znám — e4ced81f-0f6a-3594-9fe4-fc531bb2b28d
 *
 * `transcribe: false` for the one-time bulk load; flipped on later.
 */
export const tadyToZnamScraper = makeApiScraper({
  key: "tady-to-znam",
  title: "Český rozhlas — Tady to znám",
  schedule: "0 18 * * *", // nightly, offset from the other API sources
  transcribe: false,
  shows: [{ uuid: "e4ced81f-0f6a-3594-9fe4-fc531bb2b28d", name: "Tady to znám" }],
});
