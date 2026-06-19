import { db, schema, vecEnabled } from "@rozhlas/core";
import { sql } from "drizzle-orm";
import { omnisearch } from "../packages/api/src/omnisearch.ts";

console.log("vecEnabled:", vecEnabled);
const showCount = (await db.select({ c: sql<number>`count(*)` }).from(schema.shows))[0]!.c;
const embCount = (await db.select({ c: sql<number>`count(*)` }).from(schema.showEmbeddings))[0]!.c;
console.log({ showCount, embCount });

const queries = [
  "napínavý detektivní příběh na noc",
  "něco vtipného k zasmání",
  "klasická česká literatura a četba",
];
for (const q of queries) {
  const r = await omnisearch(q, 5);
  console.log(
    `\nQ: "${q}"\n  intent="${r.intent.searchText}" (claude=${r.intent.usedClaude}) vec=${r.vectorHits} fts=${r.ftsHits}`,
  );
  for (const it of r.items) console.log(`  - ${it.title}  —  ${it.showName ?? ""}`);
}
process.exit(0);
