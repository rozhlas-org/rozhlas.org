import { and, eq, isNull } from "drizzle-orm";
import { db, schema, showSlug, slugify } from "@rozhlas/core";
import type { ScrapedShow, ScrapedPart } from "@rozhlas/scrapers";

const { shows, showParts, audioFiles, people, showPeople, categories, showCategories, artworks, sources, scrapeRuns } =
  schema;

export async function upsertSource(key: string, title: string, schedule?: string) {
  await db
    .insert(sources)
    .values({ key, title, schedule })
    .onConflictDoUpdate({ target: sources.key, set: { title, schedule } });
}

export async function touchSourceRun(key: string) {
  await db.update(sources).set({ lastRunAt: new Date() }).where(eq(sources.key, key));
}

/** Open a scrape_runs audit row; returns its id to close later. */
export async function startScrapeRun(sourceKey: string): Promise<number> {
  const [row] = await db
    .insert(scrapeRuns)
    .values({ sourceKey, startedAt: new Date(), status: "running" })
    .returning({ id: scrapeRuns.id });
  return row!.id;
}

/** Close a scrape_runs row with the outcome counts (the "last run diff"). */
export async function finishScrapeRun(
  runId: number,
  outcome: { status: "ok" | "error"; discovered?: number; succeeded?: number; failed?: number; error?: string },
) {
  await db
    .update(scrapeRuns)
    .set({
      finishedAt: new Date(),
      status: outcome.status,
      discovered: outcome.discovered ?? 0,
      succeeded: outcome.succeeded ?? 0,
      failed: outcome.failed ?? 0,
      error: outcome.error ?? null,
    })
    .where(eq(scrapeRuns.id, runId));
}

export interface UpsertShowResult {
  showId: number;
  /** True when the show already exists under a *different* source (a station
   *  mirror) and was left untouched — the caller should skip its audio. */
  mirrored?: boolean;
}

/** Insert or update a show by (sourceKey, sourceId). */
export async function upsertShow(
  sourceKey: string,
  s: ScrapedShow,
): Promise<UpsertShowResult> {
  // Cross-source dedup: a rozhlas node-id is globally unique across stations, so
  // the same sourceId under a different source is the same content (e.g. a fairy
  // tale airing on both Dvojka `pohadka` and `junior-pribehy`). Keep whichever
  // source scraped it first; skip the mirror to avoid duplicate catalog rows and
  // redundant audio acquisition.
  const [mirror] = await db
    .select({ id: shows.id, sourceKey: shows.sourceKey })
    .from(shows)
    .where(eq(shows.sourceId, s.sourceId))
    .limit(1);
  if (mirror && mirror.sourceKey !== sourceKey) {
    return { showId: mirror.id, mirrored: true };
  }

  const slug = showSlug(s.title, sourceKey, s.sourceId);
  // Denormalize díl titles so full-text search matches within a part's title.
  const partsText =
    s.parts?.map((p) => p.title?.trim()).filter(Boolean).join(" \n ") || null;
  const values = {
    sourceKey,
    sourceId: s.sourceId,
    slug,
    title: s.title,
    description: s.description,
    showName: s.showName,
    publishedAt: s.publishedAt,
    durationSec: s.durationSec,
    language: s.language ?? "cs",
    rawJson: s.raw ? JSON.stringify(s.raw) : undefined,
    partsText,
  };
  const [row] = await db
    .insert(shows)
    .values(values)
    .onConflictDoUpdate({
      target: [shows.sourceKey, shows.sourceId],
      set: {
        title: values.title,
        description: values.description,
        showName: values.showName,
        publishedAt: values.publishedAt,
        durationSec: values.durationSec,
        rawJson: values.rawJson,
        partsText: values.partsText,
        updatedAt: new Date(),
      },
    })
    .returning({ id: shows.id });

  const showId = row!.id;
  if (s.people?.length) await attachPeople(showId, s.people);
  if (s.categories?.length) await attachCategories(showId, s.categories);
  if (s.artworkUrl) await upsertArtwork(showId, s.artworkUrl);
  return { showId };
}

async function attachPeople(showId: number, list: { name: string; role?: string }[]) {
  for (const p of list) {
    const [row] = await db
      .insert(people)
      .values({ name: p.name })
      .onConflictDoUpdate({ target: people.name, set: { name: p.name } })
      .returning({ id: people.id });
    await db
      .insert(showPeople)
      .values({ showId, personId: row!.id, role: p.role ?? null })
      .onConflictDoNothing();
  }
}

async function attachCategories(showId: number, list: string[]) {
  for (const name of list) {
    const key = slugify(name) || name;
    const [row] = await db
      .insert(categories)
      .values({ key, title: name })
      .onConflictDoUpdate({ target: categories.key, set: { title: name } })
      .returning({ id: categories.id });
    await db
      .insert(showCategories)
      .values({ showId, categoryId: row!.id })
      .onConflictDoNothing();
  }
}

async function upsertArtwork(showId: number, sourceUrl: string) {
  const existing = await db
    .select({ id: artworks.id })
    .from(artworks)
    .where(and(eq(artworks.showId, showId), eq(artworks.role, "cover")))
    .limit(1);
  if (existing.length) {
    await db.update(artworks).set({ sourceUrl }).where(eq(artworks.id, existing[0]!.id));
  } else {
    await db.insert(artworks).values({ showId, sourceUrl, role: "cover" });
  }
}

export interface AudioUpsertResult {
  audioFileId: number;
  needsAcquire: boolean;
}

/** Upsert one audio_files row for a show (or a specific part); idempotent. */
async function upsertAudioRow(
  showId: number,
  media: { kind: string; url: string },
  partId: number | null,
): Promise<AudioUpsertResult> {
  const cond =
    partId == null
      ? and(eq(audioFiles.showId, showId), isNull(audioFiles.partId))
      : and(eq(audioFiles.showId, showId), eq(audioFiles.partId, partId));
  const existing = await db
    .select({ id: audioFiles.id, ipfsCid: audioFiles.ipfsCid })
    .from(audioFiles)
    .where(cond)
    .limit(1);

  if (existing.length) {
    const row = existing[0]!;
    await db
      .update(audioFiles)
      .set({ manifestUrl: media.url, manifestKind: media.kind })
      .where(eq(audioFiles.id, row.id));
    return { audioFileId: row.id, needsAcquire: row.ipfsCid == null };
  }

  const [row] = await db
    .insert(audioFiles)
    .values({ showId, partId, manifestUrl: media.url, manifestKind: media.kind })
    .returning({ id: audioFiles.id });
  return { audioFileId: row!.id, needsAcquire: true };
}

/** Single-audio show (podcasts). */
export function upsertAudio(showId: number, media: { kind: string; url: string }) {
  return upsertAudioRow(showId, media, null);
}

/** Upsert a part (díl) and its audio; returns the part's audio status. */
export async function upsertPart(
  showId: number,
  part: ScrapedPart,
): Promise<AudioUpsertResult> {
  const [row] = await db
    .insert(showParts)
    .values({ showId, idx: part.idx, title: part.title, durationSec: part.durationSec })
    .onConflictDoUpdate({
      target: [showParts.showId, showParts.idx],
      set: { title: part.title, durationSec: part.durationSec, updatedAt: new Date() },
    })
    .returning({ id: showParts.id });
  return upsertAudioRow(showId, part.media, row!.id);
}

export async function getAudio(audioFileId: number) {
  const [row] = await db
    .select()
    .from(audioFiles)
    .where(eq(audioFiles.id, audioFileId))
    .limit(1);
  return row;
}

export async function setAudioMeta(
  audioFileId: number,
  meta: {
    container?: string;
    codec?: string;
    bitrate?: number;
    durationSec?: number;
    sizeBytes?: number;
    checksum?: string;
  },
) {
  await db.update(audioFiles).set(meta).where(eq(audioFiles.id, audioFileId));
}

export async function setAudioCid(audioFileId: number, ipfsCid: string, sizeBytes: number) {
  await db.update(audioFiles).set({ ipfsCid, sizeBytes }).where(eq(audioFiles.id, audioFileId));
}

export async function setAudioStreamable(audioFileId: number, streamable: boolean) {
  await db.update(audioFiles).set({ streamable }).where(eq(audioFiles.id, audioFileId));
}
