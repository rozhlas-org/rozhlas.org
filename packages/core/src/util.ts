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
