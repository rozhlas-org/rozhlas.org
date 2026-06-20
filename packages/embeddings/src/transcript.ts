import { and, eq, isNull, isNotNull } from "drizzle-orm";
import {
  createLogger,
  db,
  schema,
  ensureChunkVecTable,
  resetChunkVecTable,
  upsertChunkEmbedding,
  knnChunks,
  type ChunkKnnHit,
} from "@rozhlas/core";
import type { EmbeddingProvider } from "./types.ts";

const log = createLogger("embeddings:transcript");
const { transcriptChunks } = schema;

/**
 * Embed transcript chunks into the chunk vector store (`vec_chunks`). Embeds only
 * not-yet-embedded chunks (`embed_model IS NULL`) — scope to one transcript via
 * `transcriptId`, or pass `force` to re-embed all. If the active model differs
 * from what's stored, `vec_chunks` is rebuilt and every chunk re-embedded.
 */
export async function embedTranscriptChunks(
  provider: EmbeddingProvider,
  opts: { transcriptId?: number; force?: boolean; batch?: number } = {},
): Promise<{ embedded: number; model: string }> {
  const models = await db
    .select({ m: transcriptChunks.embedModel })
    .from(transcriptChunks)
    .where(isNotNull(transcriptChunks.embedModel))
    .groupBy(transcriptChunks.embedModel);
  const modelChanged = models.some((x) => x.m && x.m !== provider.id);

  let force = opts.force ?? false;
  if (modelChanged) {
    log.warn("chunk embedding model changed — rebuilding vec_chunks", { to: provider.id });
    resetChunkVecTable(provider.dims);
    await db.update(transcriptChunks).set({ embedModel: null });
    force = true;
  } else {
    ensureChunkVecTable(provider.dims);
  }

  const cols = { id: transcriptChunks.id, text: transcriptChunks.text };
  const notEmbedded = force ? undefined : isNull(transcriptChunks.embedModel);
  const rows = await db
    .select(cols)
    .from(transcriptChunks)
    .where(
      opts.transcriptId != null
        ? and(eq(transcriptChunks.transcriptId, opts.transcriptId), notEmbedded)
        : notEmbedded,
    );
  if (!rows.length) return { embedded: 0, model: provider.id };

  const BATCH = opts.batch ?? 64;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vecs = await provider.embed(
      batch.map((r) => r.text),
      "document",
    );
    for (let j = 0; j < batch.length; j++) {
      upsertChunkEmbedding(batch[j]!.id, vecs[j]!);
      await db
        .update(transcriptChunks)
        .set({ embedModel: provider.id })
        .where(eq(transcriptChunks.id, batch[j]!.id));
    }
    done += batch.length;
    log.info("embedded chunk batch", { done, total: rows.length });
  }
  return { embedded: done, model: provider.id };
}

/** Embed a query string and return the k nearest transcript chunk ids. */
export async function chunkVectorSearch(
  provider: EmbeddingProvider,
  queryText: string,
  k = 50,
): Promise<ChunkKnnHit[]> {
  const [vec] = await provider.embed([queryText], "query");
  if (!vec) return [];
  return knnChunks(vec, k);
}
