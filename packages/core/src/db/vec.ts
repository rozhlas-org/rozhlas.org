import { sqlite, vecEnabled } from "./index.ts";

/**
 * Vector store for show embeddings, backed by sqlite-vec (`vec0`). The virtual
 * table's dimensionality is fixed at creation, so changing embedding model/dims
 * means recreating it (see `resetVecTable`). rowid == shows.id.
 */
export function ensureVecTable(dims: number): void {
  if (!vecEnabled) throw new Error("sqlite-vec extension not loaded");
  sqlite.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_shows USING vec0(embedding float[${dims}]);`,
  );
}

/** Drop and recreate the vec table (used when embedding model/dims change). */
export function resetVecTable(dims: number): void {
  if (!vecEnabled) throw new Error("sqlite-vec extension not loaded");
  sqlite.exec("DROP TABLE IF EXISTS vec_shows;");
  ensureVecTable(dims);
}

/** Insert/replace one show's embedding (delete-then-insert; vec0 has no upsert). */
export function upsertEmbedding(showId: number, embedding: Float32Array): void {
  const del = sqlite.prepare("DELETE FROM vec_shows WHERE rowid = ?");
  const ins = sqlite.prepare("INSERT INTO vec_shows(rowid, embedding) VALUES (?, ?)");
  del.run(showId);
  ins.run(showId, embedding);
}

export interface KnnHit {
  showId: number;
  distance: number;
}

/** k-nearest shows to a query vector (cosine via vec0 default L2 on normalized vecs). */
export function knnShows(query: Float32Array, k: number): KnnHit[] {
  if (!vecEnabled) return [];
  const rows = sqlite
    .prepare(
      "SELECT rowid AS showId, distance FROM vec_shows WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
    )
    .all(query, k) as { showId: number; distance: number }[];
  return rows.map((r) => ({ showId: r.showId, distance: r.distance }));
}
