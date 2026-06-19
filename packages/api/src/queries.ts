import { and, desc, eq, inArray, isNull, sql, count } from "drizzle-orm";
import { config, db, schema, toFtsQuery } from "@rozhlas/core";

const { shows, audioFiles, artworks, people, showPeople, categories, showCategories, sources } =
  schema;

export interface ListFilters {
  q?: string;
  programme?: string; // shows.showName
  source?: string; // shows.sourceKey
  page?: number;
  pageSize?: number;
}

export interface ShowListItem {
  slug: string;
  title: string;
  showName: string | null;
  source: string;
  publishedAt: Date | null;
  durationSec: number | null;
  artworkUrl: string | null;
  streamable: boolean;
  streamUrl: string | null;
}

function streamUrl(cid: string | null): string | null {
  return cid ? `${config.IPFS_GATEWAY_URL}/ipfs/${cid}` : null;
}

function buildConditions(f: ListFilters) {
  const conds = [];
  if (f.source) conds.push(eq(shows.sourceKey, f.source));
  if (f.programme) conds.push(eq(shows.showName, f.programme));
  if (f.q?.trim()) {
    const fts = toFtsQuery(f.q);
    if (fts) {
      conds.push(
        sql`${shows.id} IN (SELECT rowid FROM shows_fts WHERE shows_fts MATCH ${fts})`,
      );
    }
  }
  return conds;
}

export async function listShows(f: ListFilters) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 24));
  const conds = buildConditions(f);
  const where = conds.length ? and(...conds) : undefined;

  const totalRows = await db.select({ total: count() }).from(shows).where(where);
  const total = totalRows[0]?.total ?? 0;

  const rows = await db
    .select({
      id: shows.id,
      slug: shows.slug,
      title: shows.title,
      showName: shows.showName,
      source: shows.sourceKey,
      publishedAt: shows.publishedAt,
      durationSec: shows.durationSec,
    })
    .from(shows)
    .where(where)
    .orderBy(desc(shows.publishedAt), desc(shows.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = rows.map((r) => r.id);
  const audioByShow = await audioForShows(ids);
  const artByShow = await artworkForShows(ids);

  const items: ShowListItem[] = rows.map((r) => {
    const a = audioByShow.get(r.id);
    return {
      slug: r.slug,
      title: r.title,
      showName: r.showName,
      source: r.source,
      publishedAt: r.publishedAt,
      durationSec: r.durationSec ?? a?.durationSec ?? null,
      artworkUrl: artByShow.get(r.id) ?? null,
      streamable: a?.streamable ?? false,
      streamUrl: streamUrl(a?.ipfsCid ?? null),
    };
  });

  return { items, total: total ?? 0, page, pageSize };
}

async function audioForShows(ids: number[]) {
  const map = new Map<number, { ipfsCid: string | null; streamable: boolean; durationSec: number | null }>();
  if (!ids.length) return map;
  const rows = await db
    .select({
      showId: audioFiles.showId,
      ipfsCid: audioFiles.ipfsCid,
      streamable: audioFiles.streamable,
      durationSec: audioFiles.durationSec,
    })
    .from(audioFiles)
    .where(and(inArray(audioFiles.showId, ids), isNull(audioFiles.partId)));
  for (const r of rows) if (!map.has(r.showId)) map.set(r.showId, r);
  return map;
}

async function artworkForShows(ids: number[]) {
  const map = new Map<number, string>();
  if (!ids.length) return map;
  const rows = await db
    .select({ showId: artworks.showId, ipfsCid: artworks.ipfsCid, sourceUrl: artworks.sourceUrl })
    .from(artworks)
    .where(inArray(artworks.showId, ids));
  for (const r of rows) {
    if (map.has(r.showId)) continue;
    const url = r.ipfsCid ? streamUrl(r.ipfsCid) : r.sourceUrl;
    if (url) map.set(r.showId, url);
  }
  return map;
}

export async function getShowBySlug(slug: string) {
  const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1);
  if (!show) return null;

  const audio = await db
    .select()
    .from(audioFiles)
    .where(eq(audioFiles.showId, show.id));
  const art = await artworkForShows([show.id]);
  const ppl = await db
    .select({ name: people.name, role: showPeople.role })
    .from(showPeople)
    .innerJoin(people, eq(showPeople.personId, people.id))
    .where(eq(showPeople.showId, show.id));
  const cats = await db
    .select({ key: categories.key, title: categories.title })
    .from(showCategories)
    .innerJoin(categories, eq(showCategories.categoryId, categories.id))
    .where(eq(showCategories.showId, show.id));

  return {
    slug: show.slug,
    title: show.title,
    description: show.description,
    showName: show.showName,
    source: show.sourceKey,
    publishedAt: show.publishedAt,
    durationSec: show.durationSec,
    artworkUrl: art.get(show.id) ?? null,
    people: ppl,
    categories: cats,
    audio: audio.map((a) => ({
      container: a.container,
      codec: a.codec,
      durationSec: a.durationSec,
      sizeBytes: a.sizeBytes,
      streamable: a.streamable,
      cid: a.ipfsCid,
      streamUrl: streamUrl(a.ipfsCid),
    })),
  };
}

/** Programmes (the effective categories) with show counts — biggest first. */
export async function listProgrammes() {
  const rows = await db
    .select({ programme: shows.showName, count: count() })
    .from(shows)
    .where(sql`${shows.showName} IS NOT NULL`)
    .groupBy(shows.showName)
    .orderBy(desc(count()));
  return rows.map((r) => ({ programme: r.programme, count: r.count }));
}

export async function listSources() {
  return db.select({ key: sources.key, title: sources.title }).from(sources);
}
