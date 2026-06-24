const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/** Lowercase, strip Czech/diacritic accents, kebab-case. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "") // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Strip HTML tags to plain text (descriptions are untrusted third-party HTML). */
export function stripHtml(s?: string | null): string {
  if (!s) return "";
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Common named HTML entities seen in rozhlas descriptions. Unknown names are
 * left untouched so literal text like "Art&Happiness;" survives intact. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  shy: "", // soft hyphen — invisible, drop it
  hellip: "…", mdash: "—", ndash: "–", minus: "−",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", bull: "•", middot: "·", deg: "°",
  copy: "©", reg: "®", trade: "™", euro: "€", times: "×", divide: "÷",
};

/** Decode the HTML entities we actually encounter (named subset + numeric).
 * Unrecognized named entities are passed through unchanged. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : m; // unknown → keep literal
  });
}

/** Normalize an untrusted HTML description to clean plain text: decode entities,
 * strip tags, drop soft hyphens, collapse whitespace. Idempotent. */
export function cleanDescription(s?: string | null): string {
  if (!s) return "";
  return decodeEntities(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/­/g, "") // any decoded soft hyphens
    .replace(/\s+/g, " ")
    .trim();
}

/** Short stable hex digest — used to keep slugs unique. */
export function shortHash(input: string, len = 6): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(input);
  return h.digest("hex").slice(0, len);
}

/** A slug guaranteed unique per (sourceKey, sourceId). */
export function showSlug(title: string, sourceKey: string, sourceId: string): string {
  const base = slugify(title) || "show";
  return `${base}-${shortHash(`${sourceKey}:${sourceId}`)}`;
}
