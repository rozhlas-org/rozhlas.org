// Operator statistics for the admin dashboard. Pure read queries over SQLite +
// live BullMQ queue counts. Kept separate from rendering so it can also back a
// JSON endpoint (/admin/stats.json) for auto-refresh.
import { sql, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@rozhlas/core";
import { allQueues } from "@rozhlas/jobs";

const { shows, audioFiles, sources, scrapeRuns, showEmbeddings, people } = schema;

const scalar = async (q: Promise<{ v: number | null }[]>): Promise<number> =>
  Number((await q)[0]?.v ?? 0);

export interface CatalogStats {
  shows: number;
  showsStreamable: number;
  programmes: number;
  people: number;
  audioTotal: number;
  audioPinned: number;
  audioStreamable: number;
  audioPending: number;
  storageBytes: number;
  embedded: number;
}

export async function catalogStats(): Promise<CatalogStats> {
  const [
    showsN,
    programmes,
    peopleN,
    showsStreamable,
    audioTotal,
    audioPinned,
    audioStreamable,
    audioPending,
    storageBytes,
    embedded,
  ] = await Promise.all([
    scalar(db.select({ v: count() }).from(shows)),
    scalar(
      db
        .select({ v: sql<number>`count(distinct ${shows.showName})` })
        .from(shows)
        .where(isNotNull(shows.showName)),
    ),
    scalar(db.select({ v: count() }).from(people)),
    scalar(
      db
        .select({ v: sql<number>`count(distinct ${audioFiles.showId})` })
        .from(audioFiles)
        .where(eq(audioFiles.streamable, true)),
    ),
    scalar(db.select({ v: count() }).from(audioFiles)),
    scalar(db.select({ v: count() }).from(audioFiles).where(isNotNull(audioFiles.ipfsCid))),
    scalar(db.select({ v: count() }).from(audioFiles).where(eq(audioFiles.streamable, true))),
    scalar(db.select({ v: count() }).from(audioFiles).where(isNull(audioFiles.ipfsCid))),
    scalar(
      db
        .select({ v: sql<number>`coalesce(sum(${audioFiles.sizeBytes}), 0)` })
        .from(audioFiles)
        .where(isNotNull(audioFiles.ipfsCid)),
    ),
    scalar(db.select({ v: count() }).from(showEmbeddings)),
  ]);

  return {
    shows: showsN,
    showsStreamable,
    programmes,
    people: peopleN,
    audioTotal,
    audioPinned,
    audioStreamable,
    audioPending,
    storageBytes,
    embedded,
  };
}

export interface SourceStat {
  key: string;
  title: string | null;
  enabled: boolean;
  schedule: string | null;
  lastRunAt: Date | null;
  shows: number;
}

export async function sourceStats(): Promise<SourceStat[]> {
  const rows = await db
    .select({ key: sources.key, title: sources.title, enabled: sources.enabled, schedule: sources.schedule, lastRunAt: sources.lastRunAt })
    .from(sources)
    .orderBy(sources.key);
  const counts = await db
    .select({ sourceKey: shows.sourceKey, c: count() })
    .from(shows)
    .groupBy(shows.sourceKey);
  const byKey = new Map(counts.map((r) => [r.sourceKey, Number(r.c)]));
  return rows.map((r) => ({ ...r, shows: byKey.get(r.key) ?? 0 }));
}

export interface RunRow {
  id: number;
  sourceKey: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  discovered: number;
  succeeded: number;
  failed: number;
  error: string | null;
}

export async function recentRuns(limit = 12): Promise<RunRow[]> {
  return db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.startedAt)).limit(limit) as Promise<RunRow[]>;
}

export interface QueueStat {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export async function queueStats(): Promise<QueueStat[]> {
  return Promise.all(
    allQueues().map(async (q) => {
      const c = await q.getJobCounts("waiting", "active", "completed", "failed", "delayed");
      return {
        name: q.name,
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        completed: c.completed ?? 0,
        failed: c.failed ?? 0,
        delayed: c.delayed ?? 0,
      };
    }),
  );
}

export interface RecentShow {
  slug: string;
  title: string;
  showName: string | null;
  sourceKey: string;
  createdAt: Date;
}

export async function recentShows(limit = 8): Promise<RecentShow[]> {
  return db
    .select({ slug: shows.slug, title: shows.title, showName: shows.showName, sourceKey: shows.sourceKey, createdAt: shows.createdAt })
    .from(shows)
    .orderBy(desc(shows.createdAt))
    .limit(limit);
}

export interface RecentPin {
  title: string;
  slug: string;
  cid: string | null;
  sizeBytes: number | null;
  streamable: boolean;
  at: Date;
}

export async function recentlyPinned(limit = 8): Promise<RecentPin[]> {
  return db
    .select({
      title: shows.title,
      slug: shows.slug,
      cid: audioFiles.ipfsCid,
      sizeBytes: audioFiles.sizeBytes,
      streamable: audioFiles.streamable,
      at: audioFiles.updatedAt,
    })
    .from(audioFiles)
    .innerJoin(shows, eq(audioFiles.showId, shows.id))
    .where(isNotNull(audioFiles.ipfsCid))
    .orderBy(desc(audioFiles.updatedAt))
    .limit(limit);
}

export interface DashboardData {
  catalog: CatalogStats;
  sources: SourceStat[];
  runs: RunRow[];
  queues: QueueStat[];
  recentShows: RecentShow[];
  recentPins: RecentPin[];
  generatedAt: string;
}

export async function dashboardData(): Promise<DashboardData> {
  const [catalog, src, runs, queues, rShows, rPins] = await Promise.all([
    catalogStats(),
    sourceStats(),
    recentRuns(),
    queueStats(),
    recentShows(),
    recentlyPinned(),
  ]);
  return {
    catalog,
    sources: src,
    runs,
    queues,
    recentShows: rShows,
    recentPins: rPins,
    generatedAt: new Date().toISOString(),
  };
}
