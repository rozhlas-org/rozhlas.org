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

/** Escape a user query into a safe FTS5 prefix match (each term ANDed). */
export function toFtsQuery(input: string): string {
  const terms = input
    .toLowerCase()
    .replace(/["()*]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return "";
  return terms.map((t) => `"${t}"*`).join(" AND ");
}
