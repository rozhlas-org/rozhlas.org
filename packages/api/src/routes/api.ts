import { Hono } from "hono";
import {
  listShows,
  getShowBySlug,
  listProgrammes,
  listSources,
} from "../queries.ts";
import { omnisearch } from "../omnisearch.ts";

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

apiRoutes.get("/shows", async (c) => {
  const { q, programme, source, page, pageSize } = c.req.query();
  const result = await listShows({
    q,
    programme,
    source,
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

apiRoutes.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const page = c.req.query("page");
  const result = await listShows({ q, page: page ? Number(page) : undefined });
  return c.json({ query: q, ...result });
});

apiRoutes.get("/programmes", async (c) => c.json(await listProgrammes()));
apiRoutes.get("/sources", async (c) => c.json(await listSources()));
