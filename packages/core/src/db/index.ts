import { dirname, isAbsolute, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { config } from "../config.ts";
import * as schema from "./schema.ts";

// Resolve a relative DATABASE_PATH against the monorepo root (this file is at
// packages/core/src/db/index.ts), so every package shares one DB regardless of
// the process cwd. Absolute paths (e.g. /data/rozhlas.db in Docker) pass through.
const repoRoot = resolve(import.meta.dir, "../../../..");

/** Absolute path to the SQLite file, with its parent dir ensured. */
export const databaseFile = isAbsolute(config.DATABASE_PATH)
  ? config.DATABASE_PATH
  : resolve(repoRoot, config.DATABASE_PATH);
mkdirSync(dirname(databaseFile), { recursive: true });

const sqlite = new Database(databaseFile, { create: true });
// Pragmas: WAL for concurrent read/write (api reads while worker writes),
// foreign keys on for cascade deletes.
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec("PRAGMA busy_timeout = 5000;");

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };
export type DB = typeof db;
