const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

/** Decode HTML entities (numeric + common named). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

/**
 * Extract a JSON array embedded in HTML/JS by key (e.g. `"playlist":[...]`),
 * via balanced-bracket scanning (respecting strings/escapes), then JSON.parse.
 * Returns null if not found or unparseable.
 */
export function extractJsonArray<T = unknown>(html: string, key: string): T[] | null {
  const marker = `"${key}":[`;
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = i + marker.length - 1; // at the '['
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, k + 1)) as T[];
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** First capture group of a meta tag, decoded. */
export function metaContent(html: string, property: string): string | undefined {
  const m =
    html.match(new RegExp(`<meta[^>]+property="${property}"[^>]+content="([^"]*)"`)) ??
    html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${property}"`));
  return m?.[1] ? decodeEntities(m[1]) : undefined;
}
