import type { Database } from "bun:sqlite";

/**
 * FTS5 full-text index over shows (title, description, programme name), kept in
 * sync by triggers. Accent-insensitive (`remove_diacritics 2`) so Czech queries
 * match regardless of diacritics. External-content table mirrors `shows`.
 */
const FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS shows_fts USING fts5(
  title, description, show_name,
  content='shows', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS shows_fts_ai AFTER INSERT ON shows BEGIN
  INSERT INTO shows_fts(rowid, title, description, show_name)
  VALUES (new.id, new.title, new.description, new.show_name);
END;

CREATE TRIGGER IF NOT EXISTS shows_fts_ad AFTER DELETE ON shows BEGIN
  INSERT INTO shows_fts(shows_fts, rowid, title, description, show_name)
  VALUES ('delete', old.id, old.title, old.description, old.show_name);
END;

CREATE TRIGGER IF NOT EXISTS shows_fts_au AFTER UPDATE ON shows BEGIN
  INSERT INTO shows_fts(shows_fts, rowid, title, description, show_name)
  VALUES ('delete', old.id, old.title, old.description, old.show_name);
  INSERT INTO shows_fts(rowid, title, description, show_name)
  VALUES (new.id, new.title, new.description, new.show_name);
END;
`;

/** Create the FTS table + triggers (idempotent) and backfill from existing rows. */
export function ensureSearchIndex(sqlite: Database): void {
  sqlite.exec(FTS_SQL);
  // Rebuild from the content table so pre-existing rows are indexed.
  sqlite.exec("INSERT INTO shows_fts(shows_fts) VALUES('rebuild');");
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
