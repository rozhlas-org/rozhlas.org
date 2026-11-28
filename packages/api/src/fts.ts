import { sqlite } from "@rozhlas/core";

/**
 * The FTS5 legs of search, as plain synchronous queries over a prepared MATCH expression
 * (see core's toFtsQuery). They run inside the search worker threads (vec-worker.ts),
 * with an in-process fallback — on a cold page cache (HDD under load) one ranked
 * transcript match can take seconds, which on the main thread froze every request.
 */

// bm25 column weights (title, description, show_name, parts_text): a term in the
// title says far more about what a show is than one buried in a long description.
const SHOW_WEIGHTS = "10.0, 3.0, 2.0, 2.0";

export type FtsIndex = "shows" | "chunks";

const SQL: Record<FtsIndex, string> = {
  // ORDER BY relevance — without it FTS5 returns rowid order, so the RRF rank of this
  // leg (and which rows survive the LIMIT) was effectively arbitrary.
  shows: `SELECT rowid AS id FROM shows_fts WHERE shows_fts MATCH ? ORDER BY bm25(shows_fts, ${SHOW_WEIGHTS}) LIMIT ?`,
  // ORDER BY rank (bm25): without it the LIMIT kept the oldest matching chunks.
  chunks: "SELECT rowid AS id FROM transcript_fts WHERE transcript_fts MATCH ? ORDER BY rank LIMIT ?",
};

/** Row ids matching `match` in `index`, best first; [] on a malformed expression. */
export function ftsMatch(index: FtsIndex, match: string, limit: number): number[] {
  try {
    return (sqlite.prepare(SQL[index]).all(match, limit) as { id: number }[]).map((r) => r.id);
  } catch {
    return [];
  }
}
