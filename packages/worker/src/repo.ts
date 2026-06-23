import { and, desc, eq, isNull, isNotNull, notInArray } from "drizzle-orm";
import { db, schema, showSlug, slugify } from "@rozhlas/core";
import { enqueue } from "@rozhlas/jobs";
import type { ScrapedShow, ScrapedPart } from "@rozhlas/scrapers";

const {
  shows,
  showParts,
  audioFiles,
  people,
  showPeople,
  categories,
  showCategories,
  artworks,
  sources,
  scrapeRuns,
  transcripts,
  transcriptChunks,
} = schema;

export async function upsertSource(key: string, title: string, schedule?: string, transcribe = true) {
  await db
    .insert(sources)
    .values({ key, title, schedule, transcribe })
    .onConflictDoUpdate({ target: sources.key, set: { title, schedule, transcribe } });
}

/** Does this audio file's source allow transcription? (per-source opt-out, default on) */
export async function sourceTranscribes(audioFileId: number): Promise<boolean> {
  const [row] = await db
    .select({ transcribe: sources.transcribe })
    .from(audioFiles)
    .innerJoin(shows, eq(shows.id, audioFiles.showId))
    .innerJoin(sources, eq(sources.key, shows.sourceKey))
    .where(eq(audioFiles.id, audioFileId))
    .limit(1);
  return row?.transcribe ?? true; // unknown source → default to transcribing
}

export async function touchSourceRun(key: string) {
  await db.update(sources).set({ lastRunAt: new Date() }).where(eq(sources.key, key));
}

/** When this source last completed a discover run (null = never → first run is full). */
export async function getSourceLastRun(key: string): Promise<Date | null> {
  const [row] = await db.select({ lastRunAt: sources.lastRunAt }).from(sources).where(eq(sources.key, key)).limit(1);
  return row?.lastRunAt ?? null;
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

// Dedup an artwork pin while it's pending/active; remove on completion so a
// later source change can re-pin (otherwise the completed job would block it).
const artworkJobOpts = (id: number) => ({ jobId: `art-${id}`, removeOnComplete: true });

async function upsertArtwork(showId: number, sourceUrl: string) {
  const existing = await db
    .select({ id: artworks.id, sourceUrl: artworks.sourceUrl, ipfsCid: artworks.ipfsCid })
    .from(artworks)
    .where(and(eq(artworks.showId, showId), eq(artworks.role, "cover")))
    .limit(1);

  let artworkId: number;
  let needsPin: boolean;
  if (existing.length) {
    const prev = existing[0]!;
    artworkId = prev.id;
    if (prev.sourceUrl !== sourceUrl) {
      // Source image changed → the pinned thumbnail is stale; reset and re-pin.
      await db
        .update(artworks)
        .set({ sourceUrl, ipfsCid: null, width: null, height: null })
        .where(eq(artworks.id, artworkId));
      needsPin = true;
    } else {
      needsPin = !prev.ipfsCid;
    }
  } else {
    const [row] = await db
      .insert(artworks)
      .values({ showId, sourceUrl, role: "cover" })
      .returning({ id: artworks.id });
    artworkId = row!.id;
    needsPin = true;
  }
  if (needsPin) await enqueue("acquire-artwork", { artworkId }, artworkJobOpts(artworkId));
}

export async function getArtwork(id: number) {
  const [row] = await db.select().from(artworks).where(eq(artworks.id, id)).limit(1);
  return row;
}

export async function setArtworkCid(id: number, ipfsCid: string, width: number, height: number) {
  await db.update(artworks).set({ ipfsCid, width, height }).where(eq(artworks.id, id));
}

/** Reuse an already-pinned thumbnail when another row shares the same source image. */
export async function findArtworkCidBySource(sourceUrl: string) {
  const [row] = await db
    .select({ ipfsCid: artworks.ipfsCid, width: artworks.width, height: artworks.height })
    .from(artworks)
    .where(and(eq(artworks.sourceUrl, sourceUrl), isNotNull(artworks.ipfsCid)))
    .limit(1);
  return row;
}

/** Queue a pin for every cover that has a source but no CID yet (backfill + self-heal). */
export async function enqueuePendingArtworks(): Promise<number> {
  const rows = await db
    .select({ id: artworks.id })
    .from(artworks)
    .where(and(isNull(artworks.ipfsCid), isNotNull(artworks.sourceUrl)));
  for (const r of rows) {
    await enqueue("acquire-artwork", { artworkId: r.id }, artworkJobOpts(r.id));
  }
  return rows.length;
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

/* ===== transcripts ===== */

export async function transcriptExists(audioFileId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: transcripts.id })
    .from(transcripts)
    .where(eq(transcripts.audioFileId, audioFileId))
    .limit(1);
  return !!row;
}

/** Insert a transcript and its chunks atomically; returns the new transcript id. */
export function saveTranscript(
  audioFileId: number,
  showId: number,
  data: {
    lang: string | null;
    model: string;
    text: string;
    segmentsJson: string;
    durationSec: number;
    chunks: { idx: number; startSec: number; endSec: number; text: string }[];
  },
): number {
  return db.transaction((tx) => {
    const [row] = tx
      .insert(transcripts)
      .values({
        audioFileId,
        showId,
        lang: data.lang,
        model: data.model,
        text: data.text,
        segmentsJson: data.segmentsJson,
        durationSec: data.durationSec,
      })
      .returning({ id: transcripts.id })
      .all();
    const transcriptId = row!.id;
    for (const c of data.chunks) {
      tx.insert(transcriptChunks)
        .values({ transcriptId, showId, idx: c.idx, startSec: c.startSec, endSec: c.endSec, text: c.text })
        .run();
    }
    return transcriptId;
  });
}

/** Queue transcription for every pinned, streamable audio that has no transcript yet. */
export async function enqueuePendingTranscripts(): Promise<number> {
  const rows = await db
    .select({ id: audioFiles.id })
    .from(audioFiles)
    .leftJoin(transcripts, eq(transcripts.audioFileId, audioFiles.id))
    .innerJoin(shows, eq(shows.id, audioFiles.showId))
    .innerJoin(sources, eq(sources.key, shows.sourceKey))
    .where(
      and(
        isNotNull(audioFiles.ipfsCid),
        eq(audioFiles.streamable, true),
        isNull(transcripts.id),
        eq(sources.transcribe, true), // skip sources opted out of transcription
      ),
    );
  for (const r of rows) {
    await enqueue("transcribe", { audioFileId: r.id }, { jobId: `tx-${r.id}`, removeOnComplete: true });
  }
  return rows.length;
}

/**
 * The single newest-broadcast untranscribed pinned audio (for the Groq backfill
 * cursor). Order MATCHES the main page's "Nejnovější" — publishedAt DESC, then
 * createdAt, then id. `exclude` skips in-session deferrals (oversized/failed).
 */
export async function nextUntranscribedByDate(exclude: number[] = []) {
  const conds = [
    isNotNull(audioFiles.ipfsCid),
    eq(audioFiles.streamable, true),
    isNull(transcripts.id),
    eq(sources.transcribe, true),
  ];
  if (exclude.length) conds.push(notInArray(audioFiles.id, exclude));
  const [row] = await db
    .select({
      id: audioFiles.id,
      showId: audioFiles.showId,
      cid: audioFiles.ipfsCid,
      durationSec: audioFiles.durationSec,
    })
    .from(audioFiles)
    .leftJoin(transcripts, eq(transcripts.audioFileId, audioFiles.id))
    .innerJoin(shows, eq(shows.id, audioFiles.showId))
    .innerJoin(sources, eq(sources.key, shows.sourceKey))
    .where(and(...conds))
    .orderBy(desc(shows.publishedAt), desc(shows.createdAt), desc(audioFiles.id))
    .limit(1);
  return row ?? null;
}
