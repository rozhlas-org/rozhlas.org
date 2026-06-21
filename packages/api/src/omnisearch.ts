import { createLogger, sqlite, stripHtml, toFtsQuery, type KnnHit } from "@rozhlas/core";
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

// Czech diacritic fold, ONE code point in → one out, so a folded string stays
// index-aligned with the original (lets us match diacritic-insensitively but
// highlight the original text). NFD-based stripping would change length.
const FOLD: Record<string, string> = {
  á: "a", č: "c", ď: "d", é: "e", ě: "e", í: "i", ň: "n", ó: "o", ř: "r",
  š: "s", ť: "t", ú: "u", ů: "u", ý: "y", ž: "z", ä: "a", ö: "o", ü: "u",
};
function fold(s: string): string {
  let out = "";
  for (const ch of s) {
    const lc = ch.toLowerCase();
    out += lc.length === 1 ? (FOLD[lc] ?? lc) : ch; // keep 1:1 even if lowercase grows
  }
  return out;
}

/** Decode the few HTML entities that survive tag-stripping in descriptions. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Significant query terms (folded, >2 chars) for boosting + snippet highlighting. */
function queryTerms(q: string): string[] {
  return fold(q)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Build a highlighted description excerpt for each show that actually contains a
 * query term. Works on the plain-text description (HTML stripped), folds for
 * diacritic-insensitive matching, and wraps the original text in <mark>. Returns
 * nothing for shows matched only by title (the title is already shown on the card).
 */
function buildSnippets(query: string, ids: number[]): Map<number, string> {
  const out = new Map<number, string>();
  const terms = queryTerms(query);
  if (!ids.length || !terms.length) return out;
  const rows = sqlite
    .prepare(`SELECT id, description FROM shows WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as { id: number; description: string | null }[];
  for (const r of rows) {
    const text = decodeEntities(stripHtml(r.description ?? "")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const folded = fold(text); // index-aligned with `text`
    const spans: [number, number][] = [];
    let earliest = -1;
    for (const t of terms) {
      for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + t.length)) {
        spans.push([i, i + t.length]);
        if (earliest < 0 || i < earliest) earliest = i;
      }
    }
    if (earliest < 0) continue; // description doesn't contain the query → no snippet
    const start = Math.max(0, earliest - 60);
    const end = Math.min(text.length, start + 200);
    const inWin = spans
      .filter(([s, e]) => e > start && s < end)
      .sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const sp of inWin) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
      else merged.push([...sp]);
    }
    let html = "";
    let cur = start;
    for (const [s, e] of merged) {
      const s2 = Math.max(s, start);
      const e2 = Math.min(e, end);
      html += escapeHtml(text.slice(cur, s2)) + "<mark>" + escapeHtml(text.slice(s2, e2)) + "</mark>";
      cur = e2;
    }
    html += escapeHtml(text.slice(cur, end));
    out.set(r.id, (start > 0 ? "…" : "") + html + (end < text.length ? "…" : ""));
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
      const title = fold(it.title);
      if (terms.length && terms.some((t) => title.includes(t))) s += 0.5 * UNIT; // title hit
      s += 0.2 * UNIT * Math.min(1, Math.log10(1 + it.plays) / 3); // gentle popularity
    }
    return s;
  };

  const ranked = pool
    .filter((id) => map.has(id))
    .sort((a, b) => score(b) - score(a))
    .slice(0, k);
  const snips = buildSnippets(query, ranked);
  const items = ranked.map((id) => {
    const it = map.get(id)!;
    const snip = snips.get(id);
    return snip ? { ...it, snippet: snip } : it;
  });
  return { intent, items, vectorHits: knn.length, ftsHits: fIds.length };
}
