// Shared text utilities for search: Czech diacritic folding, query-term
// extraction, and highlighted excerpts. Lives in its own module so both
// omnisearch and transcript-search can use it without a circular import.
import { stripHtml } from "@rozhlas/core";

// Czech diacritic fold, ONE code point in → one out, so a folded string stays
// index-aligned with the original (lets us match diacritic-insensitively but
// highlight the original text). NFD-based stripping would change length.
const FOLD: Record<string, string> = {
  á: "a", č: "c", ď: "d", é: "e", ě: "e", í: "i", ň: "n", ó: "o", ř: "r",
  š: "s", ť: "t", ú: "u", ů: "u", ý: "y", ž: "z", ä: "a", ö: "o", ü: "u",
};

export function fold(s: string): string {
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Significant query terms (folded, >2 chars) for boosting + snippet highlighting. */
export function queryTerms(q: string): string[] {
  return fold(q)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Highlighted excerpt of `rawText` around the first query-term match, folded for
 * diacritic-insensitive matching and wrapped in <mark> on the original text.
 * `lead`/`span` size the window (chars before the match / total length) — pass a
 * bigger window for transcript chunks where more spoken context is useful. With
 * `requireMatch`, returns null when no term is present (description snippets — skip
 * when the match was only in the title); without it, falls back to a plain leading
 * excerpt (transcript chunks, which may be semantic matches).
 */
export function buildExcerpt(
  rawText: string,
  terms: string[],
  requireMatch: boolean,
  lead = 60,
  span = 200,
): string | null {
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
  const start = earliest < 0 ? 0 : Math.max(0, earliest - lead);
  const end = Math.min(text.length, start + span);
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
