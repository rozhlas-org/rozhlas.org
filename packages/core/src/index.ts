export { config, isProd, type Config } from "./config.ts";
export { logger, createLogger, type Logger } from "./logger.ts";
export { db, sqlite, schema, databaseFile, vecEnabled, type DB } from "./db/index.ts";
export { slugify, shortHash, showSlug, stripHtml } from "./util.ts";
export { ensureSearchIndex, toFtsQuery } from "./db/search.ts";
export {
  ensureVecTable,
  resetVecTable,
  upsertEmbedding,
  getEmbedding,
  knnShows,
  type KnnHit,
} from "./db/vec.ts";
export * as tables from "./db/schema.ts";
