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

/**
 * Read one show's stored embedding back as a Float32Array suitable for knnShows.
 * sqlite-vec hands the column back as a raw float32 blob — reconstruct over the
 * exact byte range (honour byteOffset; bun may return a view into a pooled
 * buffer) and derive the length from byteLength so a dims change fails loud.
 */
export function getEmbedding(showId: number): Float32Array | null {
  if (!vecEnabled) return null;
  const row = sqlite.prepare("SELECT embedding FROM vec_shows WHERE rowid = ?").get(showId) as
    | { embedding: Uint8Array }
    | undefined;
  if (!row?.embedding || row.embedding.byteLength % 4 !== 0) return null;
  const buf = row.embedding;
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
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

/* ===== transcript chunk vectors (vec_chunks, rowid == transcript_chunks.id) ===== */

export function ensureChunkVecTable(dims: number): void {
  if (!vecEnabled) throw new Error("sqlite-vec extension not loaded");
  sqlite.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${dims}]);`,
  );
}

export function resetChunkVecTable(dims: number): void {
  if (!vecEnabled) throw new Error("sqlite-vec extension not loaded");
  sqlite.exec("DROP TABLE IF EXISTS vec_chunks;");
  ensureChunkVecTable(dims);
}

/** Insert/replace one chunk's embedding (delete-then-insert; vec0 has no upsert). */
export function upsertChunkEmbedding(chunkId: number, embedding: Float32Array): void {
  sqlite.prepare("DELETE FROM vec_chunks WHERE rowid = ?").run(chunkId);
  sqlite.prepare("INSERT INTO vec_chunks(rowid, embedding) VALUES (?, ?)").run(chunkId, embedding);
}

export interface ChunkKnnHit {
  chunkId: number;
  distance: number;
}

/** k-nearest transcript chunks to a query vector. */
export function knnChunks(query: Float32Array, k: number): ChunkKnnHit[] {
  if (!vecEnabled) return [];
  const rows = sqlite
    .prepare(
      "SELECT rowid AS chunkId, distance FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
    )
    .all(query, k) as { chunkId: number; distance: number }[];
  return rows.map((r) => ({ chunkId: r.chunkId, distance: r.distance }));
}

/* ===== per-show pooled transcript vectors (vec_show_transcripts, rowid == shows.id) =====
 * A show's many transcript chunks are mean-pooled into one unit vector so "similar shows"
 * can do a single KNN over transcript CONTENT (a separate space from the metadata vec_shows;
 * the two are fused via RRF in similarShows). Derived from vec_chunks → reset on model change. */

export function ensureShowTranscriptVecTable(dims: number): void {
  if (!vecEnabled) throw new Error("sqlite-vec extension not loaded");
  sqlite.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_show_transcripts USING vec0(embedding float[${dims}]);`,
  );
}

export function resetShowTranscriptVecTable(dims: number): void {
  if (!vecEnabled) throw new Error("sqlite-vec extension not loaded");
  sqlite.exec("DROP TABLE IF EXISTS vec_show_transcripts;");
  ensureShowTranscriptVecTable(dims);
}

/** A show's pooled transcript vector, or null (untranscribed, vec off, or table missing). */
export function getShowTranscriptEmbedding(showId: number): Float32Array | null {
  if (!vecEnabled) return null;
  let row: { embedding: Uint8Array } | undefined;
  try {
    row = sqlite.prepare("SELECT embedding FROM vec_show_transcripts WHERE rowid = ?").get(showId) as
      | { embedding: Uint8Array }
      | undefined;
  } catch {
    return null; // table not created yet (lazily built by the worker/backfill)
  }
  if (!row?.embedding || row.embedding.byteLength % 4 !== 0) return null;
  const buf = row.embedding;
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** k-nearest shows by pooled transcript vector. Tolerates the table not existing yet. */
export function knnShowsByTranscript(query: Float32Array, k: number): KnnHit[] {
  if (!vecEnabled) return [];
  try {
    const rows = sqlite
      .prepare(
        "SELECT rowid AS showId, distance FROM vec_show_transcripts WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
      )
      .all(query, k) as { showId: number; distance: number }[];
    return rows.map((r) => ({ showId: r.showId, distance: r.distance }));
  } catch {
    return [];
  }
}

/** Read several chunk vectors back from vec_chunks (honours byteOffset; rejects dims mismatch). */
function readChunkVectors(chunkIds: number[], dims: number): Float32Array[] {
  const out: Float32Array[] = [];
  const get = sqlite.prepare("SELECT embedding FROM vec_chunks WHERE rowid = ?");
  for (const id of chunkIds) {
    const row = get.get(id) as { embedding: Uint8Array } | undefined;
    const buf = row?.embedding;
    if (!buf || buf.byteLength % 4 !== 0 || buf.byteLength / 4 !== dims) continue;
    out.push(new Float32Array(buf.buffer, buf.byteOffset, dims));
  }
  return out;
}

/** Mean-pool unit vectors (float64 accumulate) and renormalize to unit length. Null if empty. */
export function meanPool(vectors: Float32Array[], dims: number): Float32Array | null {
  if (!vectors.length) return null;
  const acc = new Float64Array(dims);
  for (const v of vectors) for (let i = 0; i < dims; i++) acc[i]! += v[i]!;
  let norm = 0;
  for (let i = 0; i < dims; i++) {
    acc[i]! /= vectors.length;
    norm += acc[i]! * acc[i]!;
  }
  norm = Math.sqrt(norm);
  if (!(norm > 0)) return null;
  const out = new Float32Array(dims);
  for (let i = 0; i < dims; i++) out[i] = acc[i]! / norm;
  return out;
}

/**
 * Recompute a show's pooled transcript vector from its currently-embedded chunks and store it
 * (vector + bookkeeping row) atomically. Wrapped in BEGIN IMMEDIATE so concurrent embed-transcript
 * jobs for the same multi-part show can't race the delete-then-insert; the chunk set is re-read
 * inside the txn so the last writer sees every embedded chunk. Returns 1 if stored, 0 if cleared.
 */
export function recomputeShowTranscriptEmbedding(showId: number, model: string, dims: number): number {
  if (!vecEnabled) return 0;
  ensureShowTranscriptVecTable(dims);
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const ids = (
      sqlite
        .prepare("SELECT id FROM transcript_chunks WHERE show_id = ? AND embed_model IS NOT NULL")
        .all(showId) as { id: number }[]
    ).map((r) => r.id);
    const pooled = meanPool(readChunkVectors(ids, dims), dims);
    sqlite.prepare("DELETE FROM vec_show_transcripts WHERE rowid = ?").run(showId);
    if (pooled) {
      sqlite.prepare("INSERT INTO vec_show_transcripts(rowid, embedding) VALUES (?, ?)").run(showId, pooled);
      sqlite
        .prepare(
          "INSERT INTO show_transcript_embeddings (show_id, model, dims, updated_at) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT(show_id) DO UPDATE SET model = excluded.model, dims = excluded.dims, updated_at = excluded.updated_at",
        )
        .run(showId, model, dims, Date.now());
    } else {
      sqlite.prepare("DELETE FROM show_transcript_embeddings WHERE show_id = ?").run(showId);
    }
    sqlite.exec("COMMIT");
    return pooled ? 1 : 0;
  } catch (e) {
    sqlite.exec("ROLLBACK");
    throw e;
  }
}
