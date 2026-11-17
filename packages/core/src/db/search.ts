import type { Database } from "bun:sqlite";

/**
 * FTS5 full-text index over shows (title, description, programme name), kept in
 * sync by triggers. Accent-insensitive (`remove_diacritics 2`) so Czech queries
 * match regardless of diacritics. External-content table mirrors `shows`.
 */
const FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS shows_fts USING fts5(
  title, description, show_name, parts_text,
  content='shows', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS shows_fts_ai AFTER INSERT ON shows BEGIN
  INSERT INTO shows_fts(rowid, title, description, show_name, parts_text)
  VALUES (new.id, new.title, new.description, new.show_name, new.parts_text);
END;

CREATE TRIGGER IF NOT EXISTS shows_fts_ad AFTER DELETE ON shows BEGIN
  INSERT INTO shows_fts(shows_fts, rowid, title, description, show_name, parts_text)
  VALUES ('delete', old.id, old.title, old.description, old.show_name, old.parts_text);
END;

CREATE TRIGGER IF NOT EXISTS shows_fts_au AFTER UPDATE ON shows BEGIN
  INSERT INTO shows_fts(shows_fts, rowid, title, description, show_name, parts_text)
  VALUES ('delete', old.id, old.title, old.description, old.show_name, old.parts_text);
  INSERT INTO shows_fts(rowid, title, description, show_name, parts_text)
  VALUES (new.id, new.title, new.description, new.show_name, new.parts_text);
END;
`;

// FTS5 columns can't be ALTERed, so when the column set changes we drop + recreate
// the (derived, external-content) index and rebuild from `shows`.
const RESET_SQL = `
DROP TRIGGER IF EXISTS shows_fts_ai;
DROP TRIGGER IF EXISTS shows_fts_ad;
DROP TRIGGER IF EXISTS shows_fts_au;
DROP TABLE IF EXISTS shows_fts;
`;

/** (Re)create the FTS table + triggers and rebuild from existing rows. */
export function ensureSearchIndex(sqlite: Database): void {
  // If an older index (without parts_text) exists, drop it so the new columns
  // take effect. Rebuild is a full re-index regardless, so the drop is ~free.
  const cols = sqlite
    .prepare("SELECT name FROM pragma_table_info('shows_fts')")
    .all()
    .map((r) => (r as { name: string }).name);
  if (cols.length && !cols.includes("parts_text")) sqlite.exec(RESET_SQL);
  sqlite.exec(FTS_SQL);
  sqlite.exec("INSERT INTO shows_fts(shows_fts) VALUES('rebuild');");
}

/**
 * FTS5 over transcript chunks (text only), external-content on `transcript_chunks`,
 * kept in sync by triggers. Accent-insensitive like the shows index. A hit's rowid
 * == transcript_chunks.id, which carries startSec for a timestamped deep-link.
 */
const TRANSCRIPT_FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
  text,
  content='transcript_chunks', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS transcript_fts_ai AFTER INSERT ON transcript_chunks BEGIN
  INSERT INTO transcript_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS transcript_fts_ad AFTER DELETE ON transcript_chunks BEGIN
  INSERT INTO transcript_fts(transcript_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS transcript_fts_au AFTER UPDATE ON transcript_chunks BEGIN
  INSERT INTO transcript_fts(transcript_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO transcript_fts(rowid, text) VALUES (new.id, new.text);
END;
`;

/** (Re)create the transcript FTS table + triggers and rebuild from existing chunks. */
export function ensureTranscriptIndex(sqlite: Database): void {
  sqlite.exec(TRANSCRIPT_FTS_SQL);
  sqlite.exec("INSERT INTO transcript_fts(transcript_fts) VALUES('rebuild');");
}

// Czech diacritic fold (matches the FTS tokenizer's `remove_diacritics 2`).
const FOLD: Record<string, string> = {
  á: "a", č: "c", ď: "d", é: "e", ě: "e", í: "i", ň: "n", ó: "o", ř: "r",
  š: "s", ť: "t", ú: "u", ů: "u", ý: "y", ž: "z", ä: "a", ö: "o", ü: "u",
};

// Function words that carry no topic; as FTS prefix terms ("s"*, "na"*) they match
// nearly every row, so they only add noise to an AND query.
const STOPWORDS = new Set([
  "a", "i", "o", "u", "v", "ve", "s", "se", "z", "ze", "k", "ke", "na", "do", "od",
  "po", "pro", "pri", "za", "je", "to", "ten", "ta", "ty", "co", "jak", "kdo",
  "nebo", "ale", "aby", "by", "si", "mi", "the", "of", "and",
]);

// Inflectional endings (folded), longest first. Stripping one turns a declined form
// into a prefix shared by its siblings: drakovi → drak* (drak, draka, drakem),
// války → valk* (válka, válku), Sherlockem → sherlock*.
const ENDINGS = [
  "atech", "etem", "ovi", "ych", "ich", "ach", "ech", "ami", "emi", "imi", "ymi",
  "eho", "ymu", "emu", "em", "om", "ou", "um", "ym", "im",
  "y", "a", "e", "i", "u", "o",
];
const MIN_STEM = 4; // never cut below 4 chars — short stems match too much

/** Light Czech stemmer for prefix search: fold, then strip one inflectional ending. */
export function stemTerm(word: string): string {
  let w = "";
  for (const ch of word.toLowerCase()) w += FOLD[ch] ?? ch;
  if (w.length <= MIN_STEM) return w;
  for (const e of ENDINGS) {
    if (w.endsWith(e) && w.length - e.length >= MIN_STEM) return w.slice(0, -e.length);
  }
  return w;
}

/** Significant search terms of a query: folded, stemmed, stopwords dropped. Falls
 *  back to the plain words when the query is nothing but stopwords. */
export function searchTerms(input: string): string[] {
  const words = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const content = words.filter((w) => !STOPWORDS.has(stemTerm(w)));
  return [...new Set((content.length ? content : words).map(stemTerm))];
}

/** Escape a user query into a safe FTS5 prefix match (each stemmed term ANDed). */
export function toFtsQuery(input: string): string {
  const terms = searchTerms(input);
  if (!terms.length) return "";
  return terms.map((t) => `"${t}"*`).join(" AND ");
}
