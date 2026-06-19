import { inArray } from "drizzle-orm";
import {
  config,
  createLogger,
  db,
  schema,
  stripHtml,
  ensureVecTable,
  resetVecTable,
  upsertEmbedding,
  knnShows,
  type KnnHit,
} from "@rozhlas/core";
import type { EmbeddingProvider } from "./types.ts";
import { VoyageProvider } from "./voyage.ts";
import { LocalProvider } from "./local.ts";

const log = createLogger("embeddings");
const { shows, showEmbeddings } = schema;

/** Active provider: Voyage when keyed, else the offline local fallback. */
export function getProvider(): EmbeddingProvider {
  if (config.VOYAGE_API_KEY) {
    return new VoyageProvider(config.VOYAGE_API_KEY, config.VOYAGE_MODEL, config.EMBEDDING_DIMS);
  }
  return new LocalProvider(256);
}

function showText(s: { title: string; showName: string | null; description: string | null }): string {
  return [s.title, s.showName, stripHtml(s.description)].filter(Boolean).join("\n").slice(0, 8000);
}

/**
 * Embed shows into the vector store. Embeds only not-yet-embedded shows unless
 * `force`/`showIds` given. If the active model differs from what's stored, the
 * vec table is rebuilt and everything is re-embedded.
 */
export async function embedShows(
  provider: EmbeddingProvider,
  opts: { showIds?: number[]; force?: boolean; batch?: number } = {},
): Promise<{ embedded: number; model: string }> {
  const models = await db
    .select({ m: showEmbeddings.model })
    .from(showEmbeddings)
    .groupBy(showEmbeddings.model);
  const modelChanged = models.some((x) => x.m !== provider.id);

  let force = opts.force ?? false;
  if (modelChanged) {
    log.warn("embedding model changed — rebuilding vec store", { to: provider.id });
    resetVecTable(provider.dims);
    await db.delete(showEmbeddings);
    force = true;
  } else {
    ensureVecTable(provider.dims);
  }

  let rows: { id: number; title: string; showName: string | null; description: string | null }[];
  const cols = { id: shows.id, title: shows.title, showName: shows.showName, description: shows.description };
  if (opts.showIds?.length) {
    rows = await db.select(cols).from(shows).where(inArray(shows.id, opts.showIds));
  } else if (force) {
    rows = await db.select(cols).from(shows);
  } else {
    const embedded = new Set(
      (await db.select({ id: showEmbeddings.showId }).from(showEmbeddings)).map((e) => e.id),
    );
    rows = (await db.select(cols).from(shows)).filter((s) => !embedded.has(s.id));
  }
  if (!rows.length) return { embedded: 0, model: provider.id };

  const BATCH = opts.batch ?? 64;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vecs = await provider.embed(batch.map(showText), "document");
    for (let j = 0; j < batch.length; j++) {
      upsertEmbedding(batch[j]!.id, vecs[j]!);
      await db
        .insert(showEmbeddings)
        .values({ showId: batch[j]!.id, model: provider.id, dims: provider.dims })
        .onConflictDoUpdate({
          target: showEmbeddings.showId,
          set: { model: provider.id, dims: provider.dims, updatedAt: new Date() },
        });
    }
    done += batch.length;
    log.info("embedded batch", { done, total: rows.length });
  }
  return { embedded: done, model: provider.id };
}

/** Embed a query string and return the k nearest show ids. */
export async function vectorSearch(
  provider: EmbeddingProvider,
  queryText: string,
  k = 50,
): Promise<KnnHit[]> {
  const [vec] = await provider.embed([queryText], "query");
  if (!vec) return [];
  return knnShows(vec, k);
}
