import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `pohadka` — Czech Radio fairy tales (pohádky), via the mujRozhlas JSON:API.
 * Dvojka hosts the two canonical programmes; HTML-crawling Dvojka was 403-throttled
 * into near-zero coverage, so we read episodes from the API instead (full archive,
 * no throttling). Show UUIDs are embedded in the dvojka programme pages:
 *   • Hajaja  — 061d0467-51d2-3cd9-b340-cd9fad2c6606  (~81 episodes)
 *   • Pohádka — 9704b880-3199-35c0-97ba-b130899b45ee  (~8 episodes)
 * sourceId is the serial/episode UUID; mirrors with junior-pribehy de-dupe on the
 * shared UUID once that source is migrated too (PLAN: move all station sources to API).
 */
export const pohadkaScraper = makeApiScraper({
  key: "pohadka",
  title: "Český rozhlas — pohádky",
  schedule: "7 1,7,13,19 * * *", // every 6h, staggered
  shows: [
    { uuid: "061d0467-51d2-3cd9-b340-cd9fad2c6606", name: "Hajaja" },
    { uuid: "9704b880-3199-35c0-97ba-b130899b45ee", name: "Pohádka" },
  ],
});
