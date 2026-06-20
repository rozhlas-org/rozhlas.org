import { and, asc, desc, eq, inArray, isNull, isNotNull, sql, count } from "drizzle-orm";
import { config, db, schema, toFtsQuery, getEmbedding, knnShows } from "@rozhlas/core";

const { shows, showParts, audioFiles, artworks, people, showPeople, categories, showCategories, sources } =
  schema;

export type SortKey = "added" | "plays" | "alpha";

export interface ListFilters {
  q?: string;
  programme?: string; // shows.showName
  source?: string; // shows.sourceKey
  sort?: SortKey; // default "added" (newest by broadcast date first)
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
  /** Count of parts (díly) with streamable audio. 0 for single-audio shows. */
  streamablePartCount: number;
  streamUrl: string | null;
  plays: number;
  displays: number;
}

function orderForSort(sort: SortKey) {
  switch (sort) {
    case "plays":
      return [desc(shows.plays), desc(shows.publishedAt), desc(shows.id)];
    case "alpha":
      return [asc(shows.title)];
    case "added":
    default:
      // "Newest" = most recent broadcast date. createdAt (scrape time) is the
      // same for the whole archive (bulk-scraped), so it can't order by recency;
      // publishedAt is the real signal. Undated shows (NULL) sort last under DESC.
      return [desc(shows.publishedAt), desc(shows.createdAt), desc(shows.id)];
  }
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
      plays: shows.plays,
      displays: shows.displays,
    })
    .from(shows)
    .where(where)
    .orderBy(...orderForSort(f.sort ?? "added"))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = rows.map((r) => r.id);
  const audioByShow = await audioForShows(ids);
  const partsByShow = await streamablePartsForShows(ids);
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
      streamablePartCount: partsByShow.get(r.id) ?? 0,
      streamUrl: streamUrl(a?.ipfsCid ?? null),
      plays: r.plays,
      displays: r.displays,
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

/**
 * Per show, how many parts (díly) have streamable audio. Serialized shows keep
 * their audio on parts (part_id set), so this is what tells a list card "this is
 * a multi-part, playable show" — show-level `streamable` (part_id IS NULL) is
 * false for them. One batched grouped count over the page's ids; 0 if no parts.
 */
async function streamablePartsForShows(ids: number[]) {
  const map = new Map<number, number>();
  if (!ids.length) return map;
  const rows = await db
    .select({ showId: audioFiles.showId, c: count() })
    .from(audioFiles)
    .where(
      and(
        inArray(audioFiles.showId, ids),
        isNotNull(audioFiles.partId),
        eq(audioFiles.streamable, true),
      ),
    )
    .groupBy(audioFiles.showId);
  for (const r of rows) map.set(r.showId, r.c);
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

/** Hydrate ShowListItems for a set of ids (for omnisearch result ordering). */
export async function showItemsByIds(ids: number[]): Promise<Map<number, ShowListItem>> {
  const map = new Map<number, ShowListItem>();
  if (!ids.length) return map;
  const rows = await db
    .select({
      id: shows.id,
      slug: shows.slug,
      title: shows.title,
      showName: shows.showName,
      source: shows.sourceKey,
      publishedAt: shows.publishedAt,
      durationSec: shows.durationSec,
      plays: shows.plays,
      displays: shows.displays,
    })
    .from(shows)
    .where(inArray(shows.id, ids));
  const audio = await audioForShows(ids);
  const partsByShow = await streamablePartsForShows(ids);
  const art = await artworkForShows(ids);
  for (const r of rows) {
    const a = audio.get(r.id);
    map.set(r.id, {
      slug: r.slug,
      title: r.title,
      showName: r.showName,
      source: r.source,
      publishedAt: r.publishedAt,
      durationSec: r.durationSec ?? a?.durationSec ?? null,
      artworkUrl: art.get(r.id) ?? null,
      streamable: a?.streamable ?? false,
      streamablePartCount: partsByShow.get(r.id) ?? 0,
      streamUrl: a?.ipfsCid ? streamUrl(a.ipfsCid) : null,
      plays: r.plays,
      displays: r.displays,
    });
  }
  return map;
}

export async function showIdBySlug(slug: string): Promise<number | null> {
  const [r] = await db.select({ id: shows.id }).from(shows).where(eq(shows.slug, slug)).limit(1);
  return r?.id ?? null;
}

// Drop neighbours looser than this L2 distance (vec0 default; Voyage vectors are
// unit-length, so distance ∈ [0,2]). Calibrated on the live corpus: 4th-neighbour
// distances run p50≈0.70, p90≈0.87, p99≈0.93 — so this is a gentle floor that
// trims only genuine outliers (their section just shows fewer/no cards) without
// emptying normal ones.
const SIMILAR_MAX_DISTANCE = 0.95;

/**
 * Shows most similar to `showId` by their stored Voyage embedding — a local
 * sqlite-vec KNN, no embedding API call. Over-fetches, then in JS: excludes the
 * show itself, non-streamable shows, applies a relevance cutoff, and caps each
 * programme to 2 so the rail isn't just "more of the same programme". Order
 * follows KNN distance (re-projected through the hydration Map). [] if the show
 * has no embedding yet (or sqlite-vec is unavailable).
 */
export async function similarShows(showId: number, limit = 4): Promise<ShowListItem[]> {
  const vec = getEmbedding(showId);
  if (!vec) return [];
  const hits = knnShows(vec, Math.max(24, limit * 6)).filter(
    (h) => h.showId !== showId && h.distance <= SIMILAR_MAX_DISTANCE,
  );
  if (!hits.length) return [];
  const map = await showItemsByIds(hits.map((h) => h.showId));
  const out: ShowListItem[] = [];
  const perProgramme = new Map<string, number>();
  const seenTitles = new Set<string>();
  for (const h of hits) {
    const item = map.get(h.showId);
    // never recommend something unplayable — but multi-part shows are playable
    // via their parts even though show-level `streamable` is false.
    if (!item || !(item.streamable || item.streamablePartCount > 0)) continue;
    const titleKey = item.title.toLowerCase();
    if (seenTitles.has(titleKey)) continue; // drop re-published near-duplicates
    const key = item.showName ?? "";
    const n = perProgramme.get(key) ?? 0;
    if (key && n >= 2) continue; // cap ≤2 per programme → favour cross-programme discovery
    perProgramme.set(key, n + 1);
    seenTitles.add(titleKey);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Increment the play counter for a show (fire-and-forget beacon target). */
export async function incrementPlays(slug: string): Promise<void> {
  await db
    .update(shows)
    .set({ plays: sql`${shows.plays} + 1` })
    .where(eq(shows.slug, slug));
}

/** Increment the display (detail-view) counter for a show. */
export async function incrementDisplays(slug: string): Promise<void> {
  await db
    .update(shows)
    .set({ displays: sql`${shows.displays} + 1` })
    .where(eq(shows.slug, slug));
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

  const mapAudio = (a: typeof audioFiles.$inferSelect | undefined) =>
    a
      ? {
          container: a.container,
          codec: a.codec,
          durationSec: a.durationSec,
          sizeBytes: a.sizeBytes,
          streamable: a.streamable,
          cid: a.ipfsCid,
          streamUrl: streamUrl(a.ipfsCid),
        }
      : null;

  // Parts (díly) for serialized shows, each with its own audio.
  const partRows = await db
    .select()
    .from(showParts)
    .where(eq(showParts.showId, show.id))
    .orderBy(asc(showParts.idx));
  const audioByPart = new Map<number, typeof audioFiles.$inferSelect>();
  for (const a of audio) if (a.partId != null) audioByPart.set(a.partId, a);
  const parts = partRows.map((p) => ({
    idx: p.idx,
    title: p.title,
    durationSec: p.durationSec,
    audio: mapAudio(audioByPart.get(p.id)),
  }));

  return {
    slug: show.slug,
    title: show.title,
    description: show.description,
    showName: show.showName,
    source: show.sourceKey,
    publishedAt: show.publishedAt,
    durationSec: show.durationSec,
    artworkUrl: art.get(show.id) ?? null,
    plays: show.plays,
    displays: show.displays,
    people: ppl,
    categories: cats,
    parts,
    audio: audio.map(mapAudio),
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
