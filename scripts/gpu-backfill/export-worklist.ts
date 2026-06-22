// Export untranscribed pinned audio as a worklist for the GPU backfill runner.
// Newest broadcast first (matches the site). The GPU box needs only this file +
// the public gateway — no DB, no secrets.
//
//   bun run scripts/gpu-backfill/export-worklist.ts [--limit N] [--out worklist.jsonl]
//
// Output: one JSON object per line → {"audioFileId":123,"cid":"bafy...","durationSec":1980}

import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { db, schema } from "@rozhlas/core";

const { audioFiles, transcripts, shows, sources } = schema;

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const limit = arg("--limit") ? Number(arg("--limit")) : undefined;
const out = arg("--out") ?? "worklist.jsonl";

let q = db
  .select({
    audioFileId: audioFiles.id,
    cid: audioFiles.ipfsCid,
    durationSec: audioFiles.durationSec,
  })
  .from(audioFiles)
  .leftJoin(transcripts, eq(transcripts.audioFileId, audioFiles.id))
  .innerJoin(shows, eq(shows.id, audioFiles.showId))
  .innerJoin(sources, eq(sources.key, shows.sourceKey))
  .where(
    and(
      isNotNull(audioFiles.ipfsCid),
      eq(audioFiles.streamable, true),
      isNull(transcripts.id),
      eq(sources.transcribe, true),
    ),
  )
  .orderBy(desc(shows.publishedAt), desc(shows.createdAt), desc(audioFiles.id))
  .$dynamic();
if (limit) q = q.limit(limit);

const rows = await q;
const lines = rows.map((r) => JSON.stringify(r)).join("\n");
await Bun.write(out, lines + "\n");

const hours = Math.round(rows.reduce((s, r) => s + (r.durationSec ?? 0), 0) / 3600);
console.log(`wrote ${rows.length} items (~${hours} h) → ${out}`);
