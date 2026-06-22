import { Hono } from "hono";
import {
  listShows,
  getShowBySlug,
  getShowTranscripts,
  listProgrammes,
  listSources,
  incrementPlays,
  incrementDisplays,
  showIdBySlug,
  similarShows,
  listPublishedSelections,
  getPublishedSelection,
  sitemapUrls,
  type SortKey,
} from "../queries.ts";
import { omnisearch } from "../omnisearch.ts";
import { transcriptSearch } from "../transcript-search.ts";

const SORTS = new Set<SortKey>(["added", "plays", "alpha"]);

export const apiRoutes = new Hono();

apiRoutes.get("/", (c) =>
  c.json({
    name: "rozhlas.org API",
    endpoints: [
      "/api/shows?q=&programme=&source=&page=",
      "/api/shows/:slug",
      "/api/search?q=",
      "/api/omnisearch?q=",
      "/api/programmes",
      "/api/sources",
    ],
  }),
);

apiRoutes.get("/omnisearch", async (c) => {
  const q = c.req.query("q") ?? "";
  if (!q.trim()) return c.json({ error: "missing q" }, 400);
  return c.json(await omnisearch(q));
});

// Search inside transcripts → shows + timestamped snippets (optional ?programme=).
apiRoutes.get("/transcript-search", async (c) => {
  const q = c.req.query("q") ?? "";
  if (!q.trim()) return c.json({ error: "missing q" }, 400);
  const programme = c.req.query("programme") || undefined;
  return c.json(await transcriptSearch(q, { programme }));
});

apiRoutes.get("/shows", async (c) => {
  const { q, programme, source, sort, page, pageSize } = c.req.query();
  const result = await listShows({
    q,
    programme,
    source,
    sort: sort && SORTS.has(sort as SortKey) ? (sort as SortKey) : undefined,
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
  });
  return c.json(result);
});

apiRoutes.get("/shows/:slug", async (c) => {
  const show = await getShowBySlug(c.req.param("slug"));
  if (!show) return c.json({ error: "not found" }, 404);
  return c.json(show);
});

// Transcript(s) for a show, grouped by part — lazy-loaded by the "Přepis" toggle.
apiRoutes.get("/shows/:slug/transcript", async (c) => {
  const parts = await getShowTranscripts(c.req.param("slug"));
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({ parts });
});

// "Podobné pořady" — nearest shows by stored embedding (local KNN, no API call).
// Stable results → cache. Lazy below-fold fetch from the detail page.
apiRoutes.get("/shows/:slug/similar", async (c) => {
  const id = await showIdBySlug(c.req.param("slug"));
  const items = id ? await similarShows(id) : [];
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(items);
});

// Stat beacons (fire-and-forget from the frontend). 204, no body.
apiRoutes.post("/shows/:slug/play", async (c) => {
  await incrementPlays(c.req.param("slug"));
  return c.body(null, 204);
});

apiRoutes.post("/shows/:slug/display", async (c) => {
  await incrementDisplays(c.req.param("slug"));
  return c.body(null, 204);
});

apiRoutes.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const page = c.req.query("page");
  const result = await listShows({ q, page: page ? Number(page) : undefined });
  return c.json({ query: q, ...result });
});

apiRoutes.get("/programmes", async (c) => c.json(await listProgrammes()));
apiRoutes.get("/sources", async (c) => c.json(await listSources()));
// Bulk URL list consumed by the static sitemap build (web/src/pages/sitemap.xml.ts).
apiRoutes.get("/sitemap-urls", async (c) => c.json(await sitemapUrls()));

// Editorial selections ("Výběry") — published only. Tiles on the main page + a
// dedicated page per selection. `no-cache` so an operator's admin edit/delete/publish
// shows up immediately (tiny payload; revalidates rather than serving stale for 5 min).
apiRoutes.get("/selections", async (c) => {
  c.header("Cache-Control", "no-cache");
  return c.json(await listPublishedSelections());
});

apiRoutes.get("/selections/:slug", async (c) => {
  const sel = await getPublishedSelection(c.req.param("slug"));
  if (!sel) return c.json({ error: "not found" }, 404);
  c.header("Cache-Control", "no-cache");
  return c.json(sel);
});
