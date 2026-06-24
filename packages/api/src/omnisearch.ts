import { createLogger, knnShows, sqlite, toFtsQuery, type KnnHit } from "@rozhlas/core";
import { getProvider } from "@rozhlas/embeddings";
import { showItemsByIds, type ShowListItem } from "./queries.ts";
import { transcriptLegs, refineStartSec } from "./transcript-search.ts";
import { parseIntent, type Intent } from "./intent.ts";
import { buildExcerpt, fold, queryTerms } from "./text.ts";

const log = createLogger("api:omnisearch");

function ftsIds(text: string, limit = 100): number[] {
  const q = toFtsQuery(text);
  if (!q) return [];
  try {
    const rows = sqlite
      .prepare("SELECT rowid AS id FROM shows_fts WHERE shows_fts MATCH ? LIMIT ?")
      .all(q, limit) as { id: number }[];
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/** Description snippets for shows whose description contains a query term. */
function descriptionSnippets(ids: number[], terms: string[]): Map<number, string> {
  const out = new Map<number, string>();
  if (!ids.length || !terms.length) return out;
  const rows = sqlite
    .prepare(`SELECT id, description FROM shows WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as { id: number; description: string | null }[];
  for (const r of rows) {
    const html = buildExcerpt(r.description ?? "", terms, true);
    if (html) out.set(r.id, html);
  }
  return out;
}

// Cap results from one programme/serial so a single show's many episodes (or the
// díly of one serialized reading) can't flood the page — diversity over repetition.
const MAX_PER_PROGRAMME = 2;

export interface OmniResult {
  intent: Intent;
  items: ShowListItem[];
  total: number; // diversified result count across all pages (for "load more")
  hasMore: boolean; // another page exists after this offset+limit
  vectorHits: number;
  ftsHits: number;
}

/**
 * Universal search: parse intent → four retrieval legs (show vector + show FTS,
 * transcript-chunk vector + transcript-chunk FTS) fused with Reciprocal Rank
 * Fusion, then nudged by obvious signals (exact title hit, popularity). Shows
 * surfaced by spoken content carry a timestamped transcript hit; others get a
 * highlighted description snippet.
 */
export async function omnisearch(
  query: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<OmniResult> {
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 48);
  const offset = Math.max(opts.offset ?? 0, 0);
  query = query.trim().replace(/\s+/g, " "); // strip surrounding / collapse repeated whitespace
  const intent = await parseIntent(query);
  const provider = getProvider();
  // What to embed: an LLM-rewritten phrase when one ran (claude/ollama), else the
  // RAW query — Voyage is multilingual and matches a full Czech sentence better than
  // keyword soup. FTS legs use the (diacritic-preserving, prefix) keyword list.
  const vectorText = intent.provider === "heuristic" ? query : intent.searchText;
  // Embed the query ONCE and feed both the show- and transcript-chunk vector legs.
  // Best-effort: if Voyage is down/429, degrade to the keyword legs instead of failing.
  let queryVec: Float32Array | undefined;
  try {
    [queryVec] = await provider.embed([vectorText], "query");
  } catch (err) {
    log.warn("query embedding unavailable; using keyword search only", { err: String(err) });
  }
  const knn: KnnHit[] = queryVec ? knnShows(queryVec, 60) : [];
  const fIds = ftsIds(intent.searchText, 100);
  const tx = await transcriptLegs(queryVec, intent.searchText);

  // Reciprocal Rank Fusion: each leg contributes 1/(K+rank), so a show ranking in
  // several legs rises. Transcript legs are slightly down-weighted — a passing
  // spoken mention shouldn't outrank a show that's actually about the topic.
  const RRF_K = 60;
  const UNIT = 1 / RRF_K; // one rank-slot of score — the unit for the boosts below
  const TX_WEIGHT = 0.6;
  const rrf = new Map<number, number>();
  const add = (id: number, s: number) => rrf.set(id, (rrf.get(id) ?? 0) + s);
  knn.forEach((h, i) => add(h.showId, 1 / (RRF_K + i)));
  fIds.forEach((id, i) => add(id, 1 / (RRF_K + i)));
  tx.vectorShowIds.forEach((id, i) => add(id, TX_WEIGHT / (RRF_K + i)));
  tx.ftsShowIds.forEach((id, i) => add(id, TX_WEIGHT / (RRF_K + i)));

  // Generous candidate pool so paging + the per-programme diversity cap below have
  // depth (we rank/diversify the whole pool, then slice the requested page).
  const POOL = Math.max(300, (offset + limit) * 6);
  const pool = [...rrf.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, POOL)
    .map(([id]) => id);
  const map = await showItemsByIds(pool);
  const terms = queryTerms(query);
  const score = (id: number): number => {
    const it = map.get(id);
    let s = rrf.get(id) ?? 0;
    if (it) {
      const title = fold(it.title);
      if (terms.length && terms.some((t) => title.includes(t))) s += 0.5 * UNIT; // title hit
      s += 0.2 * UNIT * Math.min(1, Math.log10(1 + it.plays) / 3); // gentle popularity
    }
    return s;
  };

  // Full re-ranked order, then a per-programme diversity cap so one programme/serial
  // (all the díly of one Osudy, a recurring show's episodes) can't flood the page.
  // Keep the best-scoring MAX_PER_PROGRAMME from each; one-offs (no showName) are
  // keyed by id so distinct shows are never collapsed together.
  const reranked = pool.filter((id) => map.has(id)).sort((a, b) => score(b) - score(a));
  const perProgramme = new Map<string, number>();
  const diversified: number[] = [];
  for (const id of reranked) {
    const it = map.get(id)!;
    const key = it.showName || `#${id}`;
    const n = perProgramme.get(key) ?? 0;
    if (n >= MAX_PER_PROGRAMME) continue;
    perProgramme.set(key, n + 1);
    diversified.push(id);
  }

  const total = diversified.length;
  const pageIds = diversified.slice(offset, offset + limit);
  const snips = descriptionSnippets(pageIds, terms);
  const items = pageIds.map((id) => {
    const it = map.get(id)!;
    // Prefer the (actionable, timestamped) transcript hit when the show matched on
    // spoken content; otherwise fall back to the highlighted description snippet.
    const hit = tx.best.get(id);
    if (hit) {
      return {
        ...it,
        transcriptHit: {
          // The chunk groups ~1500 chars (~2 min) and stores only its first
          // segment's start; pin the timestamp to the segment that actually says
          // the term so the deep-link lands on the mention, not up to a minute early.
          startSec: refineStartSec(hit.transcriptId, hit.startSec, hit.endSec, terms),
          partIdx: hit.partIdx,
          // Wider window than description snippets — more spoken context around the hit.
          snippet: buildExcerpt(hit.text, terms, false, 140, 480) ?? "",
        },
      };
    }
    const snip = snips.get(id);
    return snip ? { ...it, snippet: snip } : it;
  });
  return { intent, items, total, hasMore: offset + limit < total, vectorHits: knn.length, ftsHits: fIds.length };
}
