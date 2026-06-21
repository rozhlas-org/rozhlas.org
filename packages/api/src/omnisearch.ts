import { createLogger, knnShows, sqlite, stripHtml, toFtsQuery, type KnnHit } from "@rozhlas/core";
import { getProvider } from "@rozhlas/embeddings";
import { showItemsByIds, type ShowListItem } from "./queries.ts";
import { transcriptLegs } from "./transcript-search.ts";
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
 * Highlighted ~200-char excerpt of `rawText` around the first query-term match,
 * folded for diacritic-insensitive matching and wrapped in <mark> on the original
 * text. With `requireMatch`, returns null when no term is present (description
 * snippets — skip when the match was only in the title); without it, falls back to
 * a plain leading excerpt (transcript chunks, which may be semantic matches).
 */
function buildExcerpt(rawText: string, terms: string[], requireMatch: boolean): string | null {
  const text = decodeEntities(stripHtml(rawText)).replace(/\s+/g, " ").trim();
  if (!text) return null;
  const folded = fold(text); // index-aligned with `text`
  const spans: [number, number][] = [];
  let earliest = -1;
  for (const t of terms) {
    for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + t.length)) {
      spans.push([i, i + t.length]);
      if (earliest < 0 || i < earliest) earliest = i;
    }
  }
  if (earliest < 0 && requireMatch) return null;
  const start = earliest < 0 ? 0 : Math.max(0, earliest - 60);
  const end = Math.min(text.length, start + 200);
  const inWin = spans.filter(([s, e]) => e > start && s < end).sort((a, b) => a[0] - b[0]);
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
  return (start > 0 ? "…" : "") + html + (end < text.length ? "…" : "");
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

export interface OmniResult {
  intent: Intent;
  items: ShowListItem[];
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
export async function omnisearch(query: string, k = 24): Promise<OmniResult> {
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
  const snips = descriptionSnippets(ranked, terms);
  const items = ranked.map((id) => {
    const it = map.get(id)!;
    // Prefer the (actionable, timestamped) transcript hit when the show matched on
    // spoken content; otherwise fall back to the highlighted description snippet.
    const hit = tx.best.get(id);
    if (hit) {
      return {
        ...it,
        transcriptHit: {
          startSec: hit.startSec,
          partIdx: hit.partIdx,
          snippet: buildExcerpt(hit.text, terms, false) ?? "",
        },
      };
    }
    const snip = snips.get(id);
    return snip ? { ...it, snippet: snip } : it;
  });
  return { intent, items, vectorHits: knn.length, ftsHits: fIds.length };
}
