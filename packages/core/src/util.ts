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
