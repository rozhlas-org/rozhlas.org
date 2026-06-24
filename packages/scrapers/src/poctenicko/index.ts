import { makeApiScraper } from "../mujrozhlas/index.ts";

/**
 * `poctenicko` — "Počteníčko", Český rozhlas serialized literary readings (often
 * for younger listeners), via the mujRozhlas JSON:API. A single umbrella show, so
 * we read its episodes directly by UUID (mujrozhlas.cz HTML is Cloudflare-403'd
 * like the other API sources). The UUID came from the JSON:API title search
 * (`/shows?filter[title][eq]=Počteníčko`):
 *   • Počteníčko — 3e006bb4-eb17-30ab-b2e7-3d75db4e9d0e
 * Serials de-dupe natively against the other API sources on the shared serial UUID.
 */
export const poctenickoScraper = makeApiScraper({
  key: "poctenicko",
  title: "Český rozhlas — Počteníčko",
  schedule: "7 3,9,15,21 * * *", // every 6h, staggered
  shows: [{ uuid: "3e006bb4-eb17-30ab-b2e7-3d75db4e9d0e", name: "Počteníčko" }],
});
