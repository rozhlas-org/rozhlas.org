import { createLogger, sqlite, toFtsQuery, type KnnHit } from "@rozhlas/core";
import { getProvider, vectorSearch } from "@rozhlas/embeddings";
import { showItemsByIds, type ShowListItem } from "./queries.ts";
import { parseIntent, type Intent } from "./intent.ts";

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Lowercase + strip diacritics, for forgiving title-match boosting. */
function deburr(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** Significant query terms (deburred, >2 chars) for the title boost. */
function queryTerms(q: string): string[] {
  return deburr(q)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

// ASCII sentinels: mark hits in the raw snippet, escape the text, then swap the
// sentinels for real <mark> tags — so description HTML can't inject markup.
const HL_OPEN = "@@HLO@@";
const HL_CLOSE = "@@HLC@@";

/** Highlighted FTS snippets (over the description column) for the given shows. */
function ftsSnippets(text: string, ids: number[]): Map<number, string> {
  const out = new Map<number, string>();
  const q = toFtsQuery(text);
  if (!q || !ids.length) return out;
  try {
    const rows = sqlite
      .prepare(
        `SELECT rowid AS id, snippet(shows_fts, 1, '${HL_OPEN}', '${HL_CLOSE}', '…', 14) AS snip
         FROM shows_fts WHERE rowid IN (${ids.map(() => "?").join(",")}) AND shows_fts MATCH ?`,
      )
      .all(...ids, q) as { id: number; snip: string }[];
    for (const r of rows) {
      if (!r.snip) continue;
      const safe = escapeHtml(r.snip).split(HL_OPEN).join("<mark>").split(HL_CLOSE).join("</mark>");
      out.set(r.id, safe);
    }
  } catch (err) {
    log.warn("snippet query failed", { err: String(err) });
  }
  return out;
}

export interface OmniResult {
  intent: Intent;
  items: ShowListItem[];
  vectorHits: number;
  ftsHits: number;
}

/**
 * Universal search: parse intent → semantic vector KNN + keyword FTS, fused with
 * Reciprocal Rank Fusion (rank-based, so the two score scales don't fight), then
 * nudged by a couple of obvious signals (exact title hit, popularity). Highlighted
 * description snippets are attached for the keyword matches.
 */
export async function omnisearch(query: string, k = 24): Promise<OmniResult> {
  const intent = await parseIntent(query);
  const provider = getProvider();
  // What to embed for the semantic leg: an LLM-rewritten phrase when one ran
  // (claude/ollama), else the RAW query — Voyage is multilingual and matches a
  // full Czech sentence better than keyword soup. FTS always uses the (diacritic-
  // preserving, prefix) keyword list so the keyword leg actually returns hits.
  const vectorText = intent.provider === "heuristic" ? query : intent.searchText;
  // Semantic search is best-effort: if the embedding provider is down or rate
  // limited (e.g. Voyage 429), degrade to keyword (FTS) search instead of failing.
  let knn: KnnHit[] = [];
  try {
    knn = await vectorSearch(provider, vectorText, 60);
  } catch (err) {
    log.warn("vector search unavailable; using keyword search only", { err: String(err) });
  }
  const fIds = ftsIds(intent.searchText, 100);

  // Reciprocal Rank Fusion: each list contributes 1/(K+rank), so a show that
  // ranks in both legs naturally rises. Scale-free, nothing to hand-tune.
  const RRF_K = 60;
  const UNIT = 1 / RRF_K; // one rank-slot of score — the unit for the boosts below
  const rrf = new Map<number, number>();
  const add = (id: number, s: number) => rrf.set(id, (rrf.get(id) ?? 0) + s);
  knn.forEach((h, i) => add(h.showId, 1 / (RRF_K + i)));
  fIds.forEach((id, i) => add(id, 1 / (RRF_K + i)));

  // Fetch metadata for a generous candidate pool, then re-rank with light boosts
  // (these only move near-ties; retrieval still dominates).
  const pool = [...rrf.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k * 3)
    .map(([id]) => id);
  const map = await showItemsByIds(pool);
  const terms = queryTerms(query);
  const score = (id: number): number => {
    const it = map.get(id);
    let s = rrf.get(id) ?? 0;
    if (it) {
      const title = deburr(it.title);
      if (terms.length && terms.some((t) => title.includes(t))) s += 0.5 * UNIT; // title hit
      s += 0.2 * UNIT * Math.min(1, Math.log10(1 + it.plays) / 3); // gentle popularity
    }
    return s;
  };

  const ranked = pool
    .filter((id) => map.has(id))
    .sort((a, b) => score(b) - score(a))
    .slice(0, k);
  const snips = ftsSnippets(intent.searchText, ranked);
  const items = ranked.map((id) => {
    const it = map.get(id)!;
    const snip = snips.get(id);
    return snip ? { ...it, snippet: snip } : it;
  });
  return { intent, items, vectorHits: knn.length, ftsHits: fIds.length };
}
