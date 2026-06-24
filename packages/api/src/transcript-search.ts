import { createLogger, db, knnChunks, schema, sqlite, toFtsQuery, type ChunkKnnHit } from "@rozhlas/core";
import { eq, inArray } from "drizzle-orm";
import { getProvider, chunkVectorSearch } from "@rozhlas/embeddings";
import { showItemsByIds, type ShowListItem } from "./queries.ts";
import { buildExcerpt, fold, queryTerms } from "./text.ts";

const log = createLogger("api:transcript-search");
const { transcriptChunks, transcripts, audioFiles, showParts } = schema;

/** The best transcript chunk for a show: where it is + the spoken text. */
export interface TranscriptShowHit {
  startSec: number;
  endSec: number;
  transcriptId: number; // to refine startSec to the exact spoken segment
  partIdx: number | null; // which díl (null = single-audio show)
  text: string;
}
/** Show-level transcript retrieval legs, for folding into the universal search. */
export interface TranscriptLegs {
  vectorShowIds: number[]; // shows ranked by chunk-vector hits (deduped by show)
  ftsShowIds: number[]; // shows ranked by chunk-FTS hits (deduped by show)
  best: Map<number, TranscriptShowHit>; // showId → best chunk for display
  vectorHits: number;
  ftsHits: number;
}

/**
 * Transcript retrieval as show-level ranked lists (+ the best chunk per show),
 * for the universal search to fuse alongside metadata. Takes a precomputed query
 * vector so the caller embeds the query once for both the show and chunk legs.
 */
export async function transcriptLegs(
  queryVec: Float32Array | undefined,
  ftsText: string,
): Promise<TranscriptLegs> {
  let knn: ChunkKnnHit[] = [];
  if (queryVec) {
    try {
      knn = knnChunks(queryVec, 60);
    } catch (err) {
      log.warn("chunk vector search unavailable; keyword only", { err: String(err) });
    }
  }
  const fIds = ftsChunkIds(ftsText, 120);
  const empty: TranscriptLegs = {
    vectorShowIds: [],
    ftsShowIds: [],
    best: new Map(),
    vectorHits: knn.length,
    ftsHits: fIds.length,
  };
  const chunkOrder = [...knn.map((h) => h.chunkId), ...fIds];
  const allIds = [...new Set(chunkOrder)];
  if (!allIds.length) return empty;

  const rows = await db
    .select({
      id: transcriptChunks.id,
      showId: transcriptChunks.showId,
      startSec: transcriptChunks.startSec,
      endSec: transcriptChunks.endSec,
      transcriptId: transcriptChunks.transcriptId,
      text: transcriptChunks.text,
      partIdx: showParts.idx, // null for single-audio shows
    })
    .from(transcriptChunks)
    .innerJoin(transcripts, eq(transcripts.id, transcriptChunks.transcriptId))
    .innerJoin(audioFiles, eq(audioFiles.id, transcripts.audioFileId))
    .leftJoin(showParts, eq(showParts.id, audioFiles.partId))
    .where(inArray(transcriptChunks.id, allIds));
  const info = new Map(rows.map((r) => [r.id, r]));

  const dedupByShow = (chunkIds: number[]): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const cid of chunkIds) {
      const ci = info.get(cid);
      if (!ci || seen.has(ci.showId)) continue;
      seen.add(ci.showId);
      out.push(ci.showId);
    }
    return out;
  };
  // Best chunk per show = first occurrence in vector-then-FTS rank order.
  const best = new Map<number, TranscriptShowHit>();
  for (const cid of chunkOrder) {
    const ci = info.get(cid);
    if (!ci || best.has(ci.showId)) continue;
    best.set(ci.showId, {
      startSec: ci.startSec,
      endSec: ci.endSec,
      transcriptId: ci.transcriptId,
      partIdx: ci.partIdx,
      text: ci.text,
    });
  }
  return {
    vectorShowIds: dedupByShow(knn.map((h) => h.chunkId)),
    ftsShowIds: dedupByShow(fIds),
    best,
    vectorHits: knn.length,
    ftsHits: fIds.length,
  };
}

export interface TranscriptHit {
  startSec: number; // deep-link target in the player
  endSec: number;
  snippet: string;
  partIdx: number | null; // which díl (null = single-audio show)
}
export interface TranscriptSearchResult {
  items: { show: ShowListItem; hits: TranscriptHit[] }[];
  vectorHits: number;
  ftsHits: number;
}

/**
 * Pin a chunk-level hit to the exact spoken segment. A chunk groups up to ~1500
 * chars (~2 min) of speech and stores only its first segment's start, so a mention
 * late in the chunk would deep-link up to a minute early. Scan the transcript's
 * segments within [chunkStart, chunkEnd] for the first one containing a (folded)
 * query term and return its start; fall back to the chunk start (e.g. a purely
 * semantic hit with no literal term in the text).
 */
export function refineStartSec(
  transcriptId: number,
  chunkStart: number,
  chunkEnd: number,
  terms: string[],
): number {
  if (!terms.length) return chunkStart;
  const row = sqlite
    .prepare("SELECT segments_json AS s FROM transcripts WHERE id = ?")
    .get(transcriptId) as { s?: string } | undefined;
  if (!row?.s) return chunkStart;
  try {
    const segs = JSON.parse(row.s) as { start: number; text: string }[];
    for (const sg of segs) {
      if (sg.start < chunkStart - 2 || sg.start > chunkEnd + 2) continue;
      const folded = fold(sg.text);
      if (terms.some((t) => folded.includes(t))) return Math.floor(sg.start);
    }
  } catch {
    /* malformed segments — fall back to the chunk start */
  }
  return chunkStart;
}

function ftsChunkIds(text: string, limit = 120): number[] {
  const q = toFtsQuery(text);
  if (!q) return [];
  try {
    const rows = sqlite
      .prepare("SELECT rowid AS id FROM transcript_fts WHERE transcript_fts MATCH ? LIMIT ?")
      .all(q, limit) as { id: number }[];
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Search inside transcripts: semantic (vector over chunks) + keyword (FTS over
 * chunks), fused like omnisearch, then grouped per show with the best matching
 * timestamped snippets. `programme` optionally restricts to one programme.
 */
export async function transcriptSearch(
  query: string,
  opts: { k?: number; programme?: string } = {},
): Promise<TranscriptSearchResult> {
  query = query.trim().replace(/\s+/g, " "); // strip surrounding / collapse repeated whitespace
  const k = opts.k ?? 24;
  const provider = getProvider();
  const terms = queryTerms(query);

  // Semantic leg is best-effort (Voyage 429 → keyword only), same as omnisearch.
  let knn: ChunkKnnHit[] = [];
  try {
    knn = await chunkVectorSearch(provider, query, 60);
  } catch (err) {
    log.warn("chunk vector search unavailable; keyword only", { err: String(err) });
  }
  const fIds = ftsChunkIds(query, 120);

  const scores = new Map<number, number>();
  for (const h of knn) scores.set(h.chunkId, (scores.get(h.chunkId) ?? 0) + 1 / (1 + h.distance));
  fIds.forEach((id, i) => {
    const rankBoost = 0.5 * (1 - i / Math.max(fIds.length, 1));
    scores.set(id, (scores.get(id) ?? 0) + 0.3 + rankBoost);
  });

  const chunkIds = [...scores.keys()];
  if (!chunkIds.length) return { items: [], vectorHits: knn.length, ftsHits: fIds.length };

  const rows = await db
    .select({
      id: transcriptChunks.id,
      showId: transcriptChunks.showId,
      startSec: transcriptChunks.startSec,
      endSec: transcriptChunks.endSec,
      transcriptId: transcriptChunks.transcriptId,
      text: transcriptChunks.text,
      partIdx: showParts.idx, // null for single-audio shows
    })
    .from(transcriptChunks)
    .innerJoin(transcripts, eq(transcripts.id, transcriptChunks.transcriptId))
    .innerJoin(audioFiles, eq(audioFiles.id, transcripts.audioFileId))
    .leftJoin(showParts, eq(showParts.id, audioFiles.partId))
    .where(inArray(transcriptChunks.id, chunkIds));

  // Group chunk hits per show.
  type Hit = { startSec: number; endSec: number; transcriptId: number; text: string; partIdx: number | null; score: number };
  const byShow = new Map<number, Hit[]>();
  for (const r of rows) {
    const arr = byShow.get(r.showId) ?? [];
    arr.push({ startSec: r.startSec, endSec: r.endSec, transcriptId: r.transcriptId, text: r.text, partIdx: r.partIdx, score: scores.get(r.id) ?? 0 });
    byShow.set(r.showId, arr);
  }

  // Rank shows by their best chunk; load show cards; attach top snippets.
  const rankedIds = [...byShow.entries()]
    .sort((a, b) => Math.max(...b[1].map((h) => h.score)) - Math.max(...a[1].map((h) => h.score)))
    .map(([id]) => id);
  const showMap = await showItemsByIds(rankedIds);

  const items: TranscriptSearchResult["items"] = [];
  for (const id of rankedIds) {
    const show = showMap.get(id);
    if (!show) continue;
    if (opts.programme && show.showName !== opts.programme) continue;
    const hits = byShow
      .get(id)!
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((h) => ({
        startSec: refineStartSec(h.transcriptId, h.startSec, h.endSec, terms), // exact segment, not chunk start
        endSec: h.endSec,
        snippet: buildExcerpt(h.text, terms, false, 140, 480) ?? h.text.slice(0, 280), // wider spoken context
        partIdx: h.partIdx,
      }));
    items.push({ show, hits });
    if (items.length >= k) break;
  }

  return { items, vectorHits: knn.length, ftsHits: fIds.length };
}
