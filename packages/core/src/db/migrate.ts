import { resolve } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db, sqlite, databaseFile, vecEnabled } from "./index.ts";
import { ensureSearchIndex, ensureTranscriptIndex } from "./search.ts";
import { ensureShowTranscriptVecTable } from "./vec.ts";
import { config } from "../config.ts";
import { createLogger } from "../logger.ts";

const log = createLogger("core:migrate");

const migrationsFolder = resolve(import.meta.dir, "../../drizzle");

log.info("running migrations", { db: databaseFile, migrationsFolder });
migrate(db, { migrationsFolder });
// FTS indexes rebuild only when new; FTS_REBUILD=1 forces a full re-index (e.g. after
// editing rows with triggers off, or a tokenizer change).
const forceFts = process.env.FTS_REBUILD === "1";
ensureSearchIndex(sqlite, forceFts);
ensureTranscriptIndex(sqlite, forceFts);
// vec0 virtual tables are created lazily by the worker; ensure the pooled-transcript one
// exists so the API can read it (knnShowsByTranscript) before the first pool is written.
if (vecEnabled) ensureShowTranscriptVecTable(config.EMBEDDING_DIMS);
log.info("migrations complete (incl. FTS indexes)");
