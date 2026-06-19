import { and, eq, isNull } from "drizzle-orm";
import { db, schema, showSlug, slugify } from "@rozhlas/core";
import type { ScrapedShow } from "@rozhlas/scrapers";

const { shows, audioFiles, people, showPeople, categories, showCategories, artworks, sources } =
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

export interface UpsertShowResult {
  showId: number;
}

/** Insert or update a show by (sourceKey, sourceId). */
export async function upsertShow(
  sourceKey: string,
  s: ScrapedShow,
): Promise<UpsertShowResult> {
  const slug = showSlug(s.title, sourceKey, s.sourceId);
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

/** Ensure a single audio_files row exists for the show; returns whether it still needs acquiring. */
export async function upsertAudio(
  showId: number,
  media: { kind: string; url: string },
): Promise<AudioUpsertResult> {
  const existing = await db
    .select({ id: audioFiles.id, ipfsCid: audioFiles.ipfsCid })
    .from(audioFiles)
    .where(and(eq(audioFiles.showId, showId), isNull(audioFiles.partId)))
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
    .values({ showId, manifestUrl: media.url, manifestKind: media.kind })
    .returning({ id: audioFiles.id });
  return { audioFileId: row!.id, needsAcquire: true };
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
