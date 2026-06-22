import {
  sqliteTable,
  integer,
  text,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

/** Common timestamp columns (stored as unix-ms integers). */
const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())
    .notNull(),
};

/** Registered scraper sources (one row per page-key strategy). */
export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(), // e.g. "iradio"
  title: text("title"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // Whether new audio from this source is auto-transcribed (steady-state + backfill).
  // Default on; set false for high-volume sources we deliberately skip for now.
  transcribe: integer("transcribe", { mode: "boolean" }).notNull().default(true),
  schedule: text("schedule"), // cron expression
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  ...timestamps,
});

/** A radio show / episode (the central entity). */
export const shows = sqliteTable(
  "shows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceKey: text("source_key").notNull(), // -> sources.key
    sourceId: text("source_id").notNull(), // stable id within the source
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    showName: text("show_name"), // series / programme name
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    durationSec: integer("duration_sec"),
    language: text("language").default("cs"),
    rawJson: text("raw_json"), // original API/HTML-derived payload
    partsText: text("parts_text"), // concatenated díl titles, for full-text search
    plays: integer("plays").notNull().default(0), // times audio was played
    displays: integer("displays").notNull().default(0), // times the detail was viewed
    ...timestamps,
  },
  (t) => ({
    sourceUnique: uniqueIndex("shows_source_unique").on(t.sourceKey, t.sourceId),
    publishedAtIdx: index("shows_published_at_idx").on(t.publishedAt),
    sourceKeyIdx: index("shows_source_key_idx").on(t.sourceKey),
    showNameIdx: index("shows_show_name_idx").on(t.showName), // category-group IN/GROUP BY filter
    createdAtIdx: index("shows_created_at_idx").on(t.createdAt),
    playsIdx: index("shows_plays_idx").on(t.plays),
  }),
);

/** Multi-part shows / episode segments. */
export const showParts = sqliteTable(
  "show_parts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(), // ordering within the show
    title: text("title"),
    durationSec: integer("duration_sec"),
    ...timestamps,
  },
  (t) => ({ partUnique: uniqueIndex("show_parts_unique").on(t.showId, t.idx) }),
);

/** Hosts / authors / guests. */
export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  ...timestamps,
});

export const showPeople = sqliteTable(
  "show_people",
  {
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: text("role"), // host / author / guest
  },
  (t) => ({ pk: primaryKey({ columns: [t.showId, t.personId, t.role] }) }),
);

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  title: text("title"),
});

export const showCategories = sqliteTable(
  "show_categories",
  {
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.showId, t.categoryId] }) }),
);

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const showTags = sqliteTable(
  "show_tags",
  {
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.showId, t.tagId] }) }),
);

/** Cover art — stored on IPFS or referenced by source URL until pinned. */
export const artworks = sqliteTable(
  "artworks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    ipfsCid: text("ipfs_cid"),
    sourceUrl: text("source_url"),
    width: integer("width"),
    height: integer("height"),
    role: text("role"), // cover / thumb
    ...timestamps,
  },
  (t) => ({ showIdx: index("artworks_show_idx").on(t.showId) }),
);

/**
 * Audio renditions. Audio itself lives only on IPFS (by `ipfsCid`); the server
 * keeps no public copy. `manifestKind` records how it was acquired.
 */
export const audioFiles = sqliteTable(
  "audio_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    partId: integer("part_id").references(() => showParts.id, {
      onDelete: "cascade",
    }),
    ipfsCid: text("ipfs_cid"),
    container: text("container"), // mp3 / m4a
    codec: text("codec"), // mp3 / aac
    manifestUrl: text("manifest_url"), // source stream / file url
    manifestKind: text("manifest_kind"), // dash / hls / file
    bitrate: integer("bitrate"),
    sizeBytes: integer("size_bytes"),
    durationSec: integer("duration_sec"),
    streamable: integer("streamable", { mode: "boolean" })
      .notNull()
      .default(false),
    checksum: text("checksum"),
    ...timestamps,
  },
  (t) => ({
    showIdx: index("audio_files_show_idx").on(t.showId),
    cidIdx: index("audio_files_cid_idx").on(t.ipfsCid),
  }),
);

/** Per-run audit of scrape jobs (queue state lives in Redis/BullMQ). */
export const scrapeRuns = sqliteTable("scrape_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceKey: text("source_key").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  status: text("status").notNull().default("running"), // running / ok / error
  discovered: integer("discovered").notNull().default(0),
  succeeded: integer("succeeded").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  error: text("error"),
  ...timestamps,
});

/** Bookkeeping for which shows are embedded + with which model (vectors live in vec_shows). */
export const showEmbeddings = sqliteTable("show_embeddings", {
  showId: integer("show_id")
    .primaryKey()
    .references(() => shows.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  dims: integer("dims").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())
    .notNull(),
});

/** Whisper transcript of one audio file — full text + segment-level timestamps. */
export const transcripts = sqliteTable(
  "transcripts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    audioFileId: integer("audio_file_id")
      .notNull()
      .unique()
      .references(() => audioFiles.id, { onDelete: "cascade" }),
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    lang: text("lang"), // detected language, e.g. "cs"
    model: text("model").notNull(), // e.g. "faster-whisper:large-v3"
    text: text("text").notNull(), // full transcript
    segmentsJson: text("segments_json"), // JSON: [{ start, end, text }]
    durationSec: integer("duration_sec"),
    ...timestamps,
  },
  (t) => ({ showIdx: index("transcripts_show_idx").on(t.showId) }),
);

/**
 * A timestamped slice of a transcript — the unit we embed (Voyage) and full-text
 * index (FTS5). A search hit deep-links to `startSec` in the player. `embedModel`
 * is null until embedded; non-null = embedded with that model (vectors live in vec_chunks).
 */
export const transcriptChunks = sqliteTable(
  "transcript_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transcriptId: integer("transcript_id")
      .notNull()
      .references(() => transcripts.id, { onDelete: "cascade" }),
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(), // order within the transcript
    startSec: integer("start_sec").notNull(),
    endSec: integer("end_sec").notNull(),
    text: text("text").notNull(),
    embedModel: text("embed_model"), // null = not yet embedded
    ...timestamps,
  },
  (t) => ({
    transcriptIdx: index("transcript_chunks_transcript_idx").on(t.transcriptId),
    showIdx: index("transcript_chunks_show_idx").on(t.showId),
    embedIdx: index("transcript_chunks_embed_idx").on(t.embedModel),
  }),
);

/**
 * Editorial "selections" (Výběry) — operator-curated collections shown as tiles on the
 * main page, each opening a dedicated page of its shows. Admin-managed only.
 */
export const selections = sqliteTable(
  "selections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull().unique(), // -> /vyber/:slug; set once on create
    title: text("title").notNull(),
    description: text("description"),
    thumbnailCid: text("thumbnail_cid"), // pinned cover (later phase); resolves via gateway
    thumbnailUrl: text("thumbnail_url"), // escape-hatch URL; else falls back to first item's artwork
    published: integer("published", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0), // order among selections
    ...timestamps,
  },
  (t) => ({ publishedPosIdx: index("selections_published_pos_idx").on(t.published, t.position) }),
);

/** A show (whole, or one specific díl) inside a selection, in display order. */
export const selectionItems = sqliteTable(
  "selection_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    selectionId: integer("selection_id")
      .notNull()
      .references(() => selections.id, { onDelete: "cascade" }),
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    // null = whole show; set = a specific díl. References the stable PK (not show_parts.idx,
    // which is re-keyed on re-scrape) so a curated part can't silently re-point.
    partId: integer("part_id").references(() => showParts.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0), // order within the selection
    ...timestamps,
  },
  (t) => ({
    itemUnique: uniqueIndex("selection_items_unique").on(t.selectionId, t.showId, t.partId),
    selectionPosIdx: index("selection_items_selection_pos_idx").on(t.selectionId, t.position),
  }),
);

export type Selection = typeof selections.$inferSelect;
export type SelectionItem = typeof selectionItems.$inferSelect;

/**
 * Category groups (frontend "Kategorie" tiles) — operator-curated groups that wrap
 * several programmes (shows.show_name) into one browse tile, e.g. "Pohádky".
 */
export const categoryGroups = sqliteTable(
  "category_groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull().unique(), // -> /kategorie/:slug
    title: text("title").notNull(),
    description: text("description"),
    thumbnailCid: text("thumbnail_cid"),
    thumbnailUrl: text("thumbnail_url"),
    published: integer("published", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => ({ publishedPosIdx: index("category_groups_published_pos_idx").on(t.published, t.position) }),
);

/** A programme (shows.show_name) that belongs to a category group. */
export const categoryGroupProgrammes = sqliteTable(
  "category_group_programmes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id")
      .notNull()
      .references(() => categoryGroups.id, { onDelete: "cascade" }),
    programme: text("programme").notNull(), // == shows.show_name (no stable category table)
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    progUnique: uniqueIndex("category_group_programmes_unique").on(t.groupId, t.programme),
    groupPosIdx: index("category_group_programmes_group_pos_idx").on(t.groupId, t.position),
  }),
);

export type CategoryGroup = typeof categoryGroups.$inferSelect;
export type CategoryGroupProgramme = typeof categoryGroupProgrammes.$inferSelect;

export type Show = typeof shows.$inferSelect;
export type NewShow = typeof shows.$inferInsert;
export type AudioFile = typeof audioFiles.$inferSelect;
export type Source = typeof sources.$inferSelect;
