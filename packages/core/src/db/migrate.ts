import { resolve } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db, sqlite, databaseFile } from "./index.ts";
import { ensureSearchIndex } from "./search.ts";
import { createLogger } from "../logger.ts";

const log = createLogger("core:migrate");

const migrationsFolder = resolve(import.meta.dir, "../../drizzle");

log.info("running migrations", { db: databaseFile, migrationsFolder });
migrate(db, { migrationsFolder });
ensureSearchIndex(sqlite);
log.info("migrations complete (incl. FTS index)");
