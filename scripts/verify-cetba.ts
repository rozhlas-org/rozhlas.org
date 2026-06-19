import { db, schema } from "@rozhlas/core";
import { enqueue, connection } from "@rozhlas/jobs";
import { isNotNull } from "drizzle-orm";
import { getShowBySlug } from "../packages/api/src/queries.ts";

await enqueue("discover", {
  sourceKey: "cetba",
  limit: 1,
  options: {
    seeds: [
      "/lenka-elbe-uranova-jachymov-devadesatych-let-jeden-lazensky-hotel-a-tajemstvi-9623518",
    ],
  },
});
console.log("enqueued cetba discover (1 reading)");

let ok = false;
for (let i = 0; i < 180; i++) {
  const rows = await db
    .select()
    .from(schema.audioFiles)
    .where(isNotNull(schema.audioFiles.ipfsCid));
  if (rows.some((r) => r.streamable)) {
    ok = true;
    break;
  }
  await Bun.sleep(1000);
}

const [show] = await db.select().from(schema.shows).limit(1);
if (show) {
  const detail = await getShowBySlug(show.slug);
  console.log("BOOK :", detail?.title);
  console.log("PROG :", detail?.showName, "| parts:", detail?.parts.length, "| dur:", detail?.durationSec);
  for (const p of detail?.parts ?? []) {
    console.log(
      `  part ${p.idx}: "${(p.title ?? "").slice(0, 38)}" streamable=${p.audio?.streamable} url=${(p.audio?.streamUrl ?? "").slice(0, 55)}`,
    );
  }
}
await connection.quit();
process.exit(ok ? 0 : 1);
