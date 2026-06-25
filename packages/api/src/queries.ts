import { and, asc, desc, eq, inArray, isNull, isNotNull, sql, count } from "drizzle-orm";
import { config, db, schema, toFtsQuery, getEmbedding, knnShows } from "@rozhlas/core";

const { shows, showParts, audioFiles, artworks, people, showPeople, categories, showCategories, sources, transcripts, selections, selectionItems, categoryGroups, categoryGroupProgrammes, recommendations } =
  schema;

export interface SitemapUrls {
  shows: { slug: string; lastmod: string | null }[];
  programmes: string[];
}

/** All indexable URLs for the sitemap: shows with playable audio + programmes. */
export async function sitemapUrls(): Promise<SitemapUrls> {
  const showRows = await db
    .selectDistinct({ slug: shows.slug, updatedAt: shows.updatedAt })
    .from(shows)
    .innerJoin(audioFiles, and(eq(audioFiles.showId, shows.id), eq(audioFiles.streamable, true)));
  const progRows = await db
    .selectDistinct({ name: shows.showName })
    .from(shows)
    .where(isNotNull(shows.showName));
  return {
    shows: showRows.map((r) => ({ slug: r.slug, lastmod: r.updatedAt ? r.updatedAt.toISOString() : null })),
    programmes: progRows.map((r) => r.name).filter((n): n is string => !!n),
  };
}

export type SortKey = "added" | "plays" | "alpha";

export interface ListFilters {
  q?: string;
  programme?: string; // shows.showName (single)
  programmes?: string[]; // shows.showName IN (...) — used by category groups
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
  /** Highlighted description snippet (universal search keyword matches only). */
  snippet?: string;
  /** Universal search: a timestamped spoken-content match (deep-links into playback). */
  transcriptHit?: { startSec: number; partIdx: number | null; snippet: string };
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

export function streamUrl(cid: string | null): string | null {
  return cid ? `${config.IPFS_GATEWAY_URL}/ipfs/${cid}` : null;
}

function buildConditions(f: ListFilters) {
  const conds = [];
  if (f.source) conds.push(eq(shows.sourceKey, f.source));
  if (f.programme) conds.push(eq(shows.showName, f.programme));
  if (f.programmes?.length) conds.push(inArray(shows.showName, f.programmes));
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

  const items = await hydrateShowItems(rows);
  return { items, total: total ?? 0, page, pageSize };
}

/** A bare show row (as selected for a card) — the input to hydrateShowItems. */
interface ShowCardRow {
  id: number;
  slug: string;
  title: string;
  showName: string | null;
  source: string;
  publishedAt: Date | null;
  durationSec: number | null;
  plays: number;
  displays: number;
}

/** Batch-hydrate bare show rows into ShowListItem cards (audio/parts/artwork in 3 grouped
 *  queries, no N+1). Shared by listShows and listRecommendations. */
async function hydrateShowItems(rows: ShowCardRow[]): Promise<ShowListItem[]> {
  const ids = rows.map((r) => r.id);
  const audioByShow = await audioForShows(ids);
  const partsByShow = await streamablePartsForShows(ids);
  const artByShow = await artworkForShows(ids);
  return rows.map((r) => {
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

// ===================== Selections ("Výběry") =====================

export type SelectionRow = typeof selections.$inferSelect;

export interface SelectionListItem {
  slug: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  itemCount: number;
}
export interface SelectionItemView extends ShowListItem {
  partIdx: number | null; // set = a specific díl
  partTitle: string | null;
}
export interface SelectionDetail {
  slug: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  items: SelectionItemView[];
}

/** cs-aware slug: strip diacritics, lower, hyphenate. */
function slugifyTitle(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "vyber"
  );
}

/** itemCount per selection id (batched). */
async function itemCounts(ids: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!ids.length) return map;
  const rows = await db
    .select({ sid: selectionItems.selectionId, c: count() })
    .from(selectionItems)
    .where(inArray(selectionItems.selectionId, ids))
    .groupBy(selectionItems.selectionId);
  for (const r of rows) map.set(r.sid, r.c);
  return map;
}

/** Resolve each selection's thumbnail URL: own CID → own URL → first item's show artwork. */
async function thumbForSelections(rows: SelectionRow[]): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  const needFallback: number[] = [];
  for (const s of rows) {
    if (s.thumbnailCid) map.set(s.id, streamUrl(s.thumbnailCid));
    else if (s.thumbnailUrl) map.set(s.id, s.thumbnailUrl);
    else needFallback.push(s.id);
  }
  if (needFallback.length) {
    const items = await db
      .select({ sid: selectionItems.selectionId, showId: selectionItems.showId })
      .from(selectionItems)
      .where(inArray(selectionItems.selectionId, needFallback))
      .orderBy(asc(selectionItems.position), asc(selectionItems.id));
    const firstShow = new Map<number, number>();
    for (const it of items) if (!firstShow.has(it.sid)) firstShow.set(it.sid, it.showId);
    const art = await artworkForShows([...new Set(firstShow.values())]);
    for (const sid of needFallback) {
      const sh = firstShow.get(sid);
      map.set(sid, sh != null ? (art.get(sh) ?? null) : null);
    }
  }
  return map;
}

/** Public: published selections, ordered, with itemCount + resolved thumbnail. Skips empties. */
export async function listPublishedSelections(): Promise<SelectionListItem[]> {
  const rows = await db
    .select()
    .from(selections)
    .where(eq(selections.published, true))
    .orderBy(asc(selections.position), asc(selections.id));
  if (!rows.length) return [];
  const counts = await itemCounts(rows.map((r) => r.id));
  const thumbs = await thumbForSelections(rows);
  const out: SelectionListItem[] = [];
  for (const s of rows) {
    const n = counts.get(s.id) ?? 0;
    if (n === 0) continue; // defensive: never surface an empty selection
    out.push({ slug: s.slug, title: s.title, description: s.description, thumbnailUrl: thumbs.get(s.id) ?? null, itemCount: n });
  }
  return out;
}

/** Hydrate a list of selection items (array — preserves order + duplicate shows). */
async function hydrateItems(
  items: { showId: number; partId: number | null }[],
): Promise<SelectionItemView[]> {
  if (!items.length) return [];
  const showIds = [...new Set(items.map((i) => i.showId))];
  const showRows = await db
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
    .where(inArray(shows.id, showIds));
  const showMap = new Map(showRows.map((r) => [r.id, r]));
  const audio = await audioForShows(showIds);
  const partsByShow = await streamablePartsForShows(showIds);
  const art = await artworkForShows(showIds);
  const partIds = items.map((i) => i.partId).filter((x): x is number => x != null);
  const partMap = new Map<number, { idx: number; title: string | null }>();
  if (partIds.length) {
    const pr = await db
      .select({ id: showParts.id, idx: showParts.idx, title: showParts.title })
      .from(showParts)
      .where(inArray(showParts.id, partIds));
    for (const p of pr) partMap.set(p.id, { idx: p.idx, title: p.title });
  }
  const out: SelectionItemView[] = [];
  for (const it of items) {
    const r = showMap.get(it.showId);
    if (!r) continue; // half-cascaded / deleted show — skip defensively
    const a = audio.get(it.showId);
    const part = it.partId != null ? partMap.get(it.partId) : undefined;
    out.push({
      slug: r.slug,
      title: r.title,
      showName: r.showName,
      source: r.source,
      publishedAt: r.publishedAt,
      durationSec: r.durationSec ?? a?.durationSec ?? null,
      artworkUrl: art.get(it.showId) ?? null,
      streamable: a?.streamable ?? false,
      streamablePartCount: partsByShow.get(it.showId) ?? 0,
      streamUrl: a?.ipfsCid ? streamUrl(a.ipfsCid) : null,
      plays: r.plays,
      displays: r.displays,
      partIdx: part?.idx ?? null,
      partTitle: part?.title ?? null,
    });
  }
  return out;
}

/** Public: a published selection by slug + its hydrated items. null if missing/unpublished. */
export async function getPublishedSelection(slug: string): Promise<SelectionDetail | null> {
  const [s] = await db
    .select()
    .from(selections)
    .where(and(eq(selections.slug, slug), eq(selections.published, true)))
    .limit(1);
  if (!s) return null;
  const rows = await db
    .select({ showId: selectionItems.showId, partId: selectionItems.partId })
    .from(selectionItems)
    .where(eq(selectionItems.selectionId, s.id))
    .orderBy(asc(selectionItems.position), asc(selectionItems.id));
  const items = await hydrateItems(rows);
  const thumb = (await thumbForSelections([s])).get(s.id) ?? null;
  return { slug: s.slug, title: s.title, description: s.description, thumbnailUrl: thumb, items };
}

// ---- admin (write + draft-inclusive reads) ----

export async function adminListSelections() {
  const rows = await db.select().from(selections).orderBy(asc(selections.position), asc(selections.id));
  const counts = await itemCounts(rows.map((r) => r.id));
  return rows.map((s) => ({ ...s, itemCount: counts.get(s.id) ?? 0 }));
}

export async function adminGetSelection(id: number): Promise<SelectionRow | null> {
  const [s] = await db.select().from(selections).where(eq(selections.id, id)).limit(1);
  return s ?? null;
}

/** Items of a selection with show title + díl label, for the admin editor. */
export async function adminGetSelectionItems(selectionId: number) {
  const items = await db
    .select({
      id: selectionItems.id,
      showId: selectionItems.showId,
      partId: selectionItems.partId,
      slug: shows.slug,
      title: shows.title,
      showName: shows.showName,
    })
    .from(selectionItems)
    .innerJoin(shows, eq(selectionItems.showId, shows.id))
    .where(eq(selectionItems.selectionId, selectionId))
    .orderBy(asc(selectionItems.position), asc(selectionItems.id));
  const partIds = items.map((i) => i.partId).filter((x): x is number => x != null);
  const partMap = new Map<number, { idx: number; title: string | null }>();
  if (partIds.length) {
    const pr = await db
      .select({ id: showParts.id, idx: showParts.idx, title: showParts.title })
      .from(showParts)
      .where(inArray(showParts.id, partIds));
    for (const p of pr) partMap.set(p.id, { idx: p.idx, title: p.title });
  }
  return items.map((i) => ({
    ...i,
    partIdx: i.partId != null ? (partMap.get(i.partId)?.idx ?? null) : null,
    partTitle: i.partId != null ? (partMap.get(i.partId)?.title ?? null) : null,
  }));
}

async function uniqueSelectionSlug(title: string): Promise<string> {
  const base = slugifyTitle(title);
  let slug = base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [hit] = await db.select({ id: selections.id }).from(selections).where(eq(selections.slug, slug)).limit(1);
    if (!hit) return slug;
    slug = `${base}-${n++}`;
  }
}

export interface SelectionInput {
  title: string;
  description: string | null;
  published: boolean;
}

export async function adminCreateSelection(data: SelectionInput): Promise<number> {
  const slug = await uniqueSelectionSlug(data.title);
  const [m] = await db.select({ max: sql<number>`coalesce(max(${selections.position}), 0)` }).from(selections);
  const [r] = await db
    .insert(selections)
    .values({ slug, title: data.title, description: data.description, published: data.published, position: (m?.max ?? 0) + 1 })
    .returning({ id: selections.id });
  return r!.id;
}

export async function adminUpdateSelection(id: number, data: SelectionInput): Promise<void> {
  await db
    .update(selections)
    .set({ title: data.title, description: data.description, published: data.published })
    .where(eq(selections.id, id));
}

/** Set a selection's thumbnail. The two fields are mutually exclusive: a pinned
 *  upload (cid) or an external url. The public resolver prefers cid → url → cover. */
export async function adminSetSelectionThumbnail(
  id: number,
  t: { cid: string | null; url: string | null },
): Promise<void> {
  await db
    .update(selections)
    .set({ thumbnailCid: t.cid, thumbnailUrl: t.url })
    .where(eq(selections.id, id));
}

export async function adminDeleteSelection(id: number): Promise<void> {
  await db.delete(selections).where(eq(selections.id, id)); // cascades items
}

/** Swap a selection's position with its neighbour (-1 up / +1 down). */
export async function adminReorderSelection(id: number, dir: -1 | 1): Promise<void> {
  const rows = await db.select({ id: selections.id, position: selections.position }).from(selections).orderBy(asc(selections.position), asc(selections.id));
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  await db.update(selections).set({ position: rows[j]!.position }).where(eq(selections.id, rows[i]!.id));
  await db.update(selections).set({ position: rows[i]!.position }).where(eq(selections.id, rows[j]!.id));
}

/** Add a show (whole or one díl) to a selection. De-dups (NULL part_id isn't caught by the
 *  unique index in SQLite). Returns false if it's already present. */
export async function adminAddItem(selectionId: number, showId: number, partId: number | null): Promise<boolean> {
  const dup = await db
    .select({ id: selectionItems.id })
    .from(selectionItems)
    .where(
      and(
        eq(selectionItems.selectionId, selectionId),
        eq(selectionItems.showId, showId),
        partId == null ? isNull(selectionItems.partId) : eq(selectionItems.partId, partId),
      ),
    )
    .limit(1);
  if (dup.length) return false;
  const [m] = await db
    .select({ max: sql<number>`coalesce(max(${selectionItems.position}), 0)` })
    .from(selectionItems)
    .where(eq(selectionItems.selectionId, selectionId));
  await db.insert(selectionItems).values({ selectionId, showId, partId, position: (m?.max ?? 0) + 1 });
  return true;
}

export async function adminRemoveItem(itemId: number): Promise<void> {
  await db.delete(selectionItems).where(eq(selectionItems.id, itemId));
}

export async function adminReorderItem(itemId: number, dir: -1 | 1): Promise<void> {
  const [item] = await db.select().from(selectionItems).where(eq(selectionItems.id, itemId)).limit(1);
  if (!item) return;
  const rows = await db
    .select({ id: selectionItems.id, position: selectionItems.position })
    .from(selectionItems)
    .where(eq(selectionItems.selectionId, item.selectionId))
    .orderBy(asc(selectionItems.position), asc(selectionItems.id));
  const i = rows.findIndex((r) => r.id === itemId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  await db.update(selectionItems).set({ position: rows[j]!.position }).where(eq(selectionItems.id, rows[i]!.id));
  await db.update(selectionItems).set({ position: rows[i]!.position }).where(eq(selectionItems.id, rows[j]!.id));
}

/** Title-search shows for the admin item-picker (id + label). */
export async function adminSearchShows(q: string) {
  const fts = q.trim() ? toFtsQuery(q) : null;
  const where = fts
    ? sql`${shows.id} IN (SELECT rowid FROM shows_fts WHERE shows_fts MATCH ${fts})`
    : undefined;
  return db
    .select({ id: shows.id, slug: shows.slug, title: shows.title, showName: shows.showName })
    .from(shows)
    .where(where)
    .orderBy(desc(shows.publishedAt), desc(shows.id))
    .limit(20);
}

/** Parts (díly) of a show for the admin díl chooser. */
export async function adminShowParts(showId: number) {
  return db
    .select({ id: showParts.id, idx: showParts.idx, title: showParts.title })
    .from(showParts)
    .where(eq(showParts.showId, showId))
    .orderBy(asc(showParts.idx));
}

// ===================== Recommendations (Co k poslechu) =====================

/** A recommended show card: the normal show card + the editorial note and curation time. */
export interface RecommendationItem extends ShowListItem {
  /** recommendation row id (stable; distinct from the show). */
  recId: number;
  description: string | null;
  createdAt: Date;
}

const REC_PAGE_SIZE = 30; // page-mode (all-page); homepage passes an explicit `limit`

/** Public list of published recommendations, newest-first. `limit` → page 1 with that page
 *  size (homepage, clamped to 24); else paginated at REC_PAGE_SIZE (the /co-k-poslechu page). */
export async function listRecommendations(opts: { limit?: number; page?: number }): Promise<{
  items: RecommendationItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const limit = opts.limit != null ? Math.min(24, Math.max(1, Math.trunc(Number(opts.limit)) || 1)) : null;
  const pageSize = limit ?? REC_PAGE_SIZE;
  const page = limit != null ? 1 : Math.max(1, Math.trunc(Number(opts.page)) || 1);

  const [tot] = await db.select({ total: count() }).from(recommendations).where(eq(recommendations.published, true));
  const total = tot?.total ?? 0;

  const recRows = await db
    .select({
      recId: recommendations.id,
      description: recommendations.description,
      createdAt: recommendations.createdAt,
      showId: recommendations.showId,
    })
    .from(recommendations)
    .where(eq(recommendations.published, true))
    .orderBy(desc(recommendations.createdAt), desc(recommendations.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  if (!recRows.length) return { items: [], total, page, pageSize };

  const showRows = await db
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
    .where(inArray(shows.id, recRows.map((r) => r.showId)));
  const byId = new Map(showRows.map((s) => [s.id, s]));

  // keep recommendation order; skip a recommendation whose show vanished mid-cascade
  const ordered: ShowCardRow[] = [];
  const meta: { recId: number; description: string | null; createdAt: Date }[] = [];
  for (const rr of recRows) {
    const s = byId.get(rr.showId);
    if (!s) continue;
    ordered.push(s);
    meta.push({ recId: rr.recId, description: rr.description, createdAt: rr.createdAt });
  }
  const cards = await hydrateShowItems(ordered);
  const items: RecommendationItem[] = cards.map((c, i) => ({
    ...c,
    recId: meta[i]!.recId,
    description: meta[i]!.description,
    createdAt: meta[i]!.createdAt,
  }));
  return { items, total, page, pageSize };
}

export type RecommendationAdminRow = {
  id: number;
  showId: number;
  description: string | null;
  published: boolean;
  createdAt: Date;
  slug: string;
  title: string;
  showName: string | null;
  artworkUrl: string | null;
  streamable: boolean;
};

/** All recommendations (incl. drafts) for the admin list, with show label + artwork. */
export async function adminListRecommendations(): Promise<RecommendationAdminRow[]> {
  const rows = await db
    .select({
      id: recommendations.id,
      showId: recommendations.showId,
      description: recommendations.description,
      published: recommendations.published,
      createdAt: recommendations.createdAt,
      slug: shows.slug,
      title: shows.title,
      showName: shows.showName,
    })
    .from(recommendations)
    .innerJoin(shows, eq(recommendations.showId, shows.id))
    .orderBy(desc(recommendations.createdAt), desc(recommendations.id));
  const ids = rows.map((r) => r.showId);
  const artByShow = await artworkForShows(ids);
  const audioByShow = await audioForShows(ids);
  return rows.map((r) => ({
    ...r,
    artworkUrl: artByShow.get(r.showId) ?? null,
    streamable: audioByShow.get(r.showId)?.streamable ?? false,
  }));
}

/** One recommendation + its show label/streamability, for the admin edit page. */
export async function adminGetRecommendation(id: number) {
  const [row] = await db
    .select({
      id: recommendations.id,
      showId: recommendations.showId,
      description: recommendations.description,
      published: recommendations.published,
      createdAt: recommendations.createdAt,
      slug: shows.slug,
      title: shows.title,
      showName: shows.showName,
    })
    .from(recommendations)
    .innerJoin(shows, eq(recommendations.showId, shows.id))
    .where(eq(recommendations.id, id))
    .limit(1);
  if (!row) return null;
  const audio = await audioForShows([row.showId]);
  return { ...row, streamable: audio.get(row.showId)?.streamable ?? false };
}

/** Create a recommendation. Returns the new id, or null if the show is already recommended
 *  (unique(show_id)) — the caller surfaces a friendly message (mirrors adminAddItem). */
export async function adminCreateRecommendation(
  showId: number,
  description: string | null,
  published: boolean,
): Promise<number | null> {
  const [dup] = await db
    .select({ id: recommendations.id })
    .from(recommendations)
    .where(eq(recommendations.showId, showId))
    .limit(1);
  if (dup) return null;
  const [r] = await db
    .insert(recommendations)
    .values({ showId, description, published })
    .returning({ id: recommendations.id });
  return r!.id;
}

export async function adminUpdateRecommendation(
  id: number,
  data: { description: string | null; published: boolean },
): Promise<void> {
  await db
    .update(recommendations)
    .set({ description: data.description, published: data.published })
    .where(eq(recommendations.id, id));
}

export async function adminDeleteRecommendation(id: number): Promise<void> {
  await db.delete(recommendations).where(eq(recommendations.id, id));
}

// ===================== Category groups (Kategorie tiles) =====================

export type CategoryGroupRow = typeof categoryGroups.$inferSelect;

export interface CategoryGroupListItem {
  slug: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  showCount: number;
}

const cgThumb = (g: { thumbnailCid: string | null; thumbnailUrl: string | null }): string | null =>
  (g.thumbnailCid ? streamUrl(g.thumbnailCid) : null) ?? g.thumbnailUrl ?? null;

/** showCount per group: JOIN programmes → shows on programme = show_name, GROUP BY group. */
async function groupShowCounts(ids: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!ids.length) return map;
  const rows = await db
    .select({ gid: categoryGroupProgrammes.groupId, c: count() })
    .from(categoryGroupProgrammes)
    .innerJoin(shows, eq(shows.showName, categoryGroupProgrammes.programme))
    .where(inArray(categoryGroupProgrammes.groupId, ids))
    .groupBy(categoryGroupProgrammes.groupId);
  for (const r of rows) map.set(r.gid, r.c);
  return map;
}

async function groupProgrammes(groupId: number): Promise<string[]> {
  const rows = await db
    .select({ p: categoryGroupProgrammes.programme })
    .from(categoryGroupProgrammes)
    .where(eq(categoryGroupProgrammes.groupId, groupId))
    .orderBy(asc(categoryGroupProgrammes.position), asc(categoryGroupProgrammes.id));
  return rows.map((r) => r.p);
}

/** Public: published category groups, ordered, with showCount + thumbnail. Skips empties. */
export async function listPublishedCategoryGroups(): Promise<CategoryGroupListItem[]> {
  const rows = await db
    .select()
    .from(categoryGroups)
    .where(eq(categoryGroups.published, true))
    .orderBy(asc(categoryGroups.position), asc(categoryGroups.id));
  if (!rows.length) return [];
  const counts = await groupShowCounts(rows.map((r) => r.id));
  const out: CategoryGroupListItem[] = [];
  for (const g of rows) {
    const n = counts.get(g.id) ?? 0;
    if (n === 0) continue; // never surface an empty group
    out.push({ slug: g.slug, title: g.title, description: g.description, thumbnailUrl: cgThumb(g), showCount: n });
  }
  return out;
}

export interface CategoryGroupDetail {
  slug: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  programmes: string[];
  items: ShowListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** Public: a published group's meta + a paginated grid of its shows. null if missing/unpublished. */
export async function getPublishedCategoryGroup(slug: string, page?: number): Promise<CategoryGroupDetail | null> {
  const [g] = await db
    .select()
    .from(categoryGroups)
    .where(and(eq(categoryGroups.slug, slug), eq(categoryGroups.published, true)))
    .limit(1);
  if (!g) return null;
  const programmes = await groupProgrammes(g.id);
  const list = programmes.length
    ? await listShows({ programmes, page })
    : { items: [], total: 0, page: page ?? 1, pageSize: 24 };
  return { slug: g.slug, title: g.title, description: g.description, thumbnailUrl: cgThumb(g), programmes, ...list };
}

// ---- admin ----

export async function adminListCategoryGroups() {
  const rows = await db.select().from(categoryGroups).orderBy(asc(categoryGroups.position), asc(categoryGroups.id));
  const counts = await groupShowCounts(rows.map((r) => r.id));
  // programmeCount per group (incl. empties) for the admin list
  const progCounts = new Map<number, number>();
  if (rows.length) {
    const pr = await db
      .select({ gid: categoryGroupProgrammes.groupId, c: count() })
      .from(categoryGroupProgrammes)
      .where(inArray(categoryGroupProgrammes.groupId, rows.map((r) => r.id)))
      .groupBy(categoryGroupProgrammes.groupId);
    for (const r of pr) progCounts.set(r.gid, r.c);
  }
  return rows.map((g) => ({ ...g, showCount: counts.get(g.id) ?? 0, programmeCount: progCounts.get(g.id) ?? 0 }));
}

export async function adminGetCategoryGroup(id: number): Promise<CategoryGroupRow | null> {
  const [g] = await db.select().from(categoryGroups).where(eq(categoryGroups.id, id)).limit(1);
  return g ?? null;
}

export async function adminGetGroupProgrammes(groupId: number): Promise<string[]> {
  return groupProgrammes(groupId);
}

async function uniqueCategoryGroupSlug(title: string): Promise<string> {
  const base = slugifyTitle(title);
  let slug = base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [hit] = await db.select({ id: categoryGroups.id }).from(categoryGroups).where(eq(categoryGroups.slug, slug)).limit(1);
    if (!hit) return slug;
    slug = `${base}-${n++}`;
  }
}

export interface CategoryGroupInput {
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  published: boolean;
}

export async function adminCreateCategoryGroup(data: CategoryGroupInput): Promise<number> {
  const slug = await uniqueCategoryGroupSlug(data.title);
  const [m] = await db.select({ max: sql<number>`coalesce(max(${categoryGroups.position}), 0)` }).from(categoryGroups);
  const [r] = await db
    .insert(categoryGroups)
    .values({ slug, title: data.title, description: data.description, thumbnailUrl: data.thumbnailUrl, published: data.published, position: (m?.max ?? 0) + 1 })
    .returning({ id: categoryGroups.id });
  return r!.id;
}

export async function adminUpdateCategoryGroup(id: number, data: CategoryGroupInput): Promise<void> {
  await db
    .update(categoryGroups)
    .set({ title: data.title, description: data.description, thumbnailUrl: data.thumbnailUrl, published: data.published })
    .where(eq(categoryGroups.id, id));
}

/** Persist thumbnail fields independently (used by the upload handler). */
export async function adminSetCategoryGroupThumbnail(id: number, fields: { thumbnailCid?: string | null; thumbnailUrl?: string | null }): Promise<void> {
  await db.update(categoryGroups).set(fields).where(eq(categoryGroups.id, id));
}

export async function adminDeleteCategoryGroup(id: number): Promise<void> {
  await db.delete(categoryGroups).where(eq(categoryGroups.id, id)); // cascades programmes
}

export async function adminReorderCategoryGroup(id: number, dir: -1 | 1): Promise<void> {
  const rows = await db.select({ id: categoryGroups.id, position: categoryGroups.position }).from(categoryGroups).orderBy(asc(categoryGroups.position), asc(categoryGroups.id));
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  await db.update(categoryGroups).set({ position: rows[j]!.position }).where(eq(categoryGroups.id, rows[i]!.id));
  await db.update(categoryGroups).set({ position: rows[i]!.position }).where(eq(categoryGroups.id, rows[j]!.id));
}

/** Replace a group's programme set (checkbox form posts the full selection). */
export async function adminSetGroupProgrammes(groupId: number, programmes: string[]): Promise<void> {
  const uniq = [...new Set(programmes.map((p) => p.trim()).filter(Boolean))];
  await db.delete(categoryGroupProgrammes).where(eq(categoryGroupProgrammes.groupId, groupId));
  if (!uniq.length) return;
  await db.insert(categoryGroupProgrammes).values(uniq.map((programme, i) => ({ groupId, programme, position: i })));
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
  // Which of this show's audio files have a transcript (drives the "Přepis" UI).
  const txAudioIds = new Set(
    (await db.select({ id: transcripts.audioFileId }).from(transcripts).where(eq(transcripts.showId, show.id))).map(
      (t) => t.id,
    ),
  );
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
          hasTranscript: txAudioIds.has(a.id),
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

export interface ShowTranscriptPart {
  partIdx: number | null; // null = single-audio show
  lang: string | null;
  text: string;
  segments: { start: number; end: number; text: string }[];
}

/** All transcripts for a show, grouped by part (ordered) — for the detail "Přepis" UI. */
export async function getShowTranscripts(slug: string): Promise<ShowTranscriptPart[]> {
  const [show] = await db.select({ id: shows.id }).from(shows).where(eq(shows.slug, slug)).limit(1);
  if (!show) return [];
  const rows = await db
    .select({
      partIdx: showParts.idx,
      lang: transcripts.lang,
      text: transcripts.text,
      segmentsJson: transcripts.segmentsJson,
    })
    .from(transcripts)
    .leftJoin(audioFiles, eq(audioFiles.id, transcripts.audioFileId))
    .leftJoin(showParts, eq(showParts.id, audioFiles.partId))
    .where(eq(transcripts.showId, show.id))
    .orderBy(asc(showParts.idx));
  return rows.map((r) => ({
    partIdx: r.partIdx ?? null,
    lang: r.lang,
    text: r.text,
    segments: r.segmentsJson
      ? (JSON.parse(r.segmentsJson) as { start: number; end: number; text: string }[])
      : [],
  }));
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
