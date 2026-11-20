import { sqlite, toFtsQuery, type KnnHit } from "@rozhlas/core";
import { embedQuery } from "./query-embed.ts";
import { knnShowsAsync } from "./vec-pool.ts";
import { showItemsByIds, type ShowListItem } from "./queries.ts";
import { transcriptLegs, refineStartSec, type TranscriptShowHit } from "./transcript-search.ts";
import { parseIntent, type Intent } from "./intent.ts";
import { buildExcerpt, fold, queryTerms } from "./text.ts";

// bm25 column weights (title, description, show_name, parts_text): a term in the
// title says far more about what a show is than one buried in a long description.
const FTS_WEIGHTS = "10.0, 3.0, 2.0, 2.0";

function ftsIds(text: string, limit = 100): number[] {
  const q = toFtsQuery(text);
  if (!q) return [];
  try {
    // ORDER BY relevance — without it FTS5 returns rowid order, so the RRF rank of
    // this leg (and which 100 rows survive the LIMIT) was effectively arbitrary.
    const rows = sqlite
      .prepare(
        `SELECT rowid AS id FROM shows_fts WHERE shows_fts MATCH ? ORDER BY bm25(shows_fts, ${FTS_WEIGHTS}) LIMIT ?`,
      )
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
// Strong title matches are exempt (see below): four Sherlock Holmes episodes of one
// programme are four answers, not repetition.
const MAX_PER_PROGRAMME = 2;

// When the query matches literally somewhere, vector-only neighbours are kept only if
// they sit within this distance of the best vector hit — close paraphrases survive,
// the "same genre, different topic" tail (Poe, Lovecraft for "sherlock holmes") goes.
const VECTOR_ONLY_MARGIN = 0.1;

// A title match whose terms all appear this early is a headline match (what the show
// is about) rather than one item in a long multi-topic magazine title.
const TITLE_HEAD_CHARS = 80;

/** Index where every term occurs at a word start in `folded`, i.e. the furthest of
 *  the terms' first occurrences; -1 if some term is missing. Prefix match, so Czech
 *  declension ("sherlock" → "Sherlocka", "Sherlockem") still counts. */
function allTermsAt(folded: string, terms: string[]): number {
  let last = 0;
  for (const t of terms) {
    const m = new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").exec(folded);
    if (!m) return -1;
    last = Math.max(last, m.index);
  }
  return last;
}

export interface OmniResult {
  intent: Intent;
  items: ShowListItem[];
  total: number; // diversified result count across all pages (for "load more")
  hasMore: boolean; // another page exists after this offset+limit
  vectorHits: number;
  ftsHits: number;
}

/** The fully ranked, diversified result for one query — everything paging needs. */
interface Ranked {
  intent: Intent;
  diversified: number[];
  map: Map<number, ShowListItem>;
  txBest: Map<number, TranscriptShowHit>;
  terms: string[];
  vectorHits: number;
  ftsHits: number;
}

// Ranking costs an embedding call plus vector scans; "Načíst další" and repeat
// searches reuse it instead of recomputing for every page.
const RANK_CACHE_TTL_MS = 10 * 60_000;
const RANK_CACHE_MAX = 200;
const rankCache = new Map<string, { at: number; ranked: Promise<Ranked> }>();

function rankCached(query: string): Promise<Ranked> {
  const key = query.toLowerCase();
  const hit = rankCache.get(key);
  if (hit && Date.now() - hit.at < RANK_CACHE_TTL_MS) {
    rankCache.delete(key); // LRU: re-insert as most recent
    rankCache.set(key, hit);
    return hit.ranked;
  }
  // Cache the promise so concurrent identical searches share one computation;
  // drop it on failure so the next attempt retries.
  const ranked = rank(query);
  rankCache.set(key, { at: Date.now(), ranked });
  ranked.catch(() => rankCache.delete(key));
  while (rankCache.size > RANK_CACHE_MAX) rankCache.delete(rankCache.keys().next().value!);
  return ranked;
}

async function rank(query: string): Promise<Ranked> {
  const intent = await parseIntent(query);
  // What to embed: an LLM-rewritten phrase when one ran (claude/ollama), else the
  // RAW query — Voyage is multilingual and matches a full Czech sentence better than
  // keyword soup. FTS legs use the (diacritic-preserving, prefix) keyword list.
  const vectorText = intent.provider === "heuristic" ? query : intent.searchText;
  // Embed the query ONCE and feed both the show- and transcript-chunk vector legs.
  // Best-effort: if Voyage is down/429, degrade to the keyword legs instead of failing.
  const queryVec = await embedQuery(vectorText);
  // Vector legs run off the main thread (vec-pool) — and concurrently with each other.
  const [knn, tx] = await Promise.all([
    queryVec ? knnShowsAsync(queryVec, 60) : Promise.resolve([] as KnnHit[]),
    transcriptLegs(queryVec, intent.searchText),
  ]);
  const fIds = ftsIds(intent.searchText, 100);

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
  // depth (we rank/diversify the whole pool once, cache it, then slice pages). The
  // legs return at most ~400 distinct shows, so this keeps every candidate.
  const POOL = 400;
  const pool = [...rrf.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, POOL)
    .map(([id]) => id);
  const map = await showItemsByIds(pool);
  const terms = queryTerms(query);

  // Literal evidence beats semantic proximity. A show whose metadata contains every
  // query term (show FTS leg) is ranked by a bonus worth more than a whole RRF leg;
  // all terms in the title earn more, and early in the title (a headline match) most.
  const metaHit = new Set(fIds);
  const lexical = new Set([...fIds, ...tx.ftsShowIds]);
  const titlePos = new Map<number, number>();
  for (const id of pool) {
    const it = map.get(id);
    if (it && terms.length) titlePos.set(id, allTermsAt(fold(it.title), terms));
  }
  const headline = (id: number) => {
    const p = titlePos.get(id) ?? -1;
    return p >= 0 && p < TITLE_HEAD_CHARS;
  };
  const score = (id: number): number => {
    const it = map.get(id);
    let s = rrf.get(id) ?? 0;
    if (metaHit.has(id)) s += 1.5 * UNIT;
    if ((titlePos.get(id) ?? -1) >= 0) s += 2 * UNIT;
    if (headline(id)) s += 2 * UNIT;
    if (it) s += 0.2 * UNIT * Math.min(1, Math.log10(1 + it.plays) / 3); // gentle popularity
    return s;
  };

  // A short name/title lookup ("sherlock holmes") that matches literally doesn't need
  // the semantic tail: keep a vector-only candidate only if it's about as close as the
  // best vector hit. Long descriptive queries keep it — there the vector legs are the
  // point and a literal all-terms match is incidental.
  const trimVectorOnly = terms.length > 0 && terms.length <= 3 && lexical.size >= 3;
  const bestDist = knn[0]?.distance ?? Infinity;
  const nearDist = new Map(knn.map((h) => [h.showId, h.distance]));
  const keep = (id: number) =>
    !trimVectorOnly || lexical.has(id) || (nearDist.get(id) ?? Infinity) <= bestDist + VECTOR_ONLY_MARGIN;

  // Full re-ranked order, then a per-programme diversity cap so one programme/serial
  // (all the díly of one Osudy, a recurring show's episodes) can't flood the page.
  // Keep the best-scoring MAX_PER_PROGRAMME from each; one-offs (no showName) are
  // keyed by id so distinct shows are never collapsed together. Headline matches
  // don't count against (nor are limited by) the cap.
  const reranked = pool.filter((id) => map.has(id) && keep(id)).sort((a, b) => score(b) - score(a));
  const perProgramme = new Map<string, number>();
  const diversified: number[] = [];
  for (const id of reranked) {
    const it = map.get(id)!;
    if (headline(id)) {
      diversified.push(id);
      continue;
    }
    const key = it.showName || `#${id}`;
    const n = perProgramme.get(key) ?? 0;
    if (n >= MAX_PER_PROGRAMME) continue;
    perProgramme.set(key, n + 1);
    diversified.push(id);
  }

  return {
    intent,
    diversified,
    map,
    txBest: tx.best,
    terms,
    vectorHits: knn.length,
    ftsHits: fIds.length,
  };
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
  const { intent, diversified, map, txBest, terms, vectorHits, ftsHits } = await rankCached(query);

  const total = diversified.length;
  const pageIds = diversified.slice(offset, offset + limit);
  const snips = descriptionSnippets(pageIds, terms);
  const items = pageIds.map((id) => {
    const it = map.get(id)!;
    // Prefer the (actionable, timestamped) transcript hit when the show matched on
    // spoken content; otherwise fall back to the highlighted description snippet.
    const hit = txBest.get(id);
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
  return { intent, items, total, hasMore: offset + limit < total, vectorHits, ftsHits };
}
