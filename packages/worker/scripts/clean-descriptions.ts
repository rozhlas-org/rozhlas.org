/**
 * One-off backfill: normalize existing `shows.description` values to clean plain
 * text (decode HTML entities like &nbsp;/&amp;, strip leftover tags, collapse
 * whitespace) using the same `cleanDescription` the scraper now applies on write.
 *
 * Only `shows.description` is touched — titles are left alone (their only "&…;"
 * occurrences are literal text, e.g. "Art&Happiness;", not entities).
 *
 * Usage (from repo root):
 *   bun packages/worker/scripts/clean-descriptions.ts            # dry run (no writes)
 *   bun packages/worker/scripts/clean-descriptions.ts --apply    # write changes
 */
import { Database } from "bun:sqlite";
import { cleanDescription } from "@rozhlas/core";

const apply = process.argv.includes("--apply");
const dbPath = process.env.DB_PATH ?? "data/rozhlas.db";
const db = new Database(dbPath, apply ? { readwrite: true } : { readonly: true });
db.exec("PRAGMA busy_timeout=10000");

const rows = db
  .query("SELECT id, description d FROM shows WHERE description IS NOT NULL AND description<>''")
  .all() as { id: number; d: string }[];

const changes: { id: number; next: string }[] = [];
for (const r of rows) {
  const next = cleanDescription(r.d);
  if (next !== r.d) changes.push({ id: r.id, next });
}

console.log(`scanned ${rows.length} descriptions; ${changes.length} would change`);
console.log("\nsample before/after:");
for (const c of changes.slice(0, 5)) {
  const before = rows.find((r) => r.id === c.id)!.d;
  console.log(`  [${c.id}]`);
  console.log(`    - ${JSON.stringify(before.slice(0, 120))}`);
  console.log(`    + ${JSON.stringify(c.next.slice(0, 120))}`);
}

if (!apply) {
  console.log("\nDRY RUN — no rows written. Re-run with --apply to commit.");
  process.exit(0);
}

// Pure data normalization — leave updated_at untouched so "recently updated"
// ordering is unaffected.
const upd = db.query("UPDATE shows SET description=? WHERE id=?");
const tx = db.transaction((batch: { id: number; next: string }[]) => {
  for (const c of batch) upd.run(c.next, c.id);
});
tx(changes);
console.log(`\nAPPLIED — updated ${changes.length} rows.`);
process.exit(0);
