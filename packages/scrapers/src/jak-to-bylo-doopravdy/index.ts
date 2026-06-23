import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `jak-to-bylo-doopravdy` — "Jak to bylo doopravdy", via the mujRozhlas JSON:API.
 * Single umbrella show, pinned by UUID
 * (resolved from `/shows?filter[title][eq]=Jak to bylo doopravdy`):
 *   • Jak to bylo doopravdy — b742d96b-a56e-364b-9522-65dae3cf5352  (~399 episodes)
 *
 * Transcription on: the bulk back-catalogue was loaded with it off; now flipped
 * on so future episodes transcribe normally (already-loaded files stay
 * un-transcribed unless deliberately backfilled).
 */
export const jakToByloDoopravdyScraper = makeApiScraper({
  key: "jak-to-bylo-doopravdy",
  title: "Jak to bylo doopravdy",
  schedule: "30 11 * * *", // nightly; :30 offset (the hourly slots are taken)
  transcribe: true,
  shows: [{ uuid: "b742d96b-a56e-364b-9522-65dae3cf5352", name: "Jak to bylo doopravdy" }],
});
