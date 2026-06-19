import { Hono } from "hono";
import { listShows, getShowBySlug, listProgrammes } from "../queries.ts";
import { omnisearch } from "../omnisearch.ts";
import { layout } from "../views/layout.tsx";
import { ShowGrid, Pagination, formatDate, formatDuration, stripHtml } from "../views/ui.tsx";

export const pageRoutes = new Hono();

pageRoutes.get("/omnisearch", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  const result = q ? await omnisearch(q) : null;
  const content = (
    <section class="omni">
      <h1>Omnisearch</h1>
      <p class="omni__hint">
        Popište náladu nebo situaci — např. „jedu sám v noci a potřebuju něco napínavého".
      </p>
      <form class="omni__form" action="/omnisearch" method="get">
        <textarea name="q" rows={2} placeholder="Co máte chuť poslouchat?">{q}</textarea>
        <button type="submit">Najít</button>
      </form>
      {result ? (
        <>
          <p class="omni__intent">
            Hledám: <strong>{result.intent.searchText}</strong>
            {result.intent.themes.length ? ` · témata: ${result.intent.themes.join(", ")}` : ""}
            {` · intent: ${result.intent.provider}`} · {result.vectorHits} sémantických /{" "}
            {result.ftsHits} klíčových shod
          </p>
          <ShowGrid items={result.items} />
        </>
      ) : null}
    </section>
  );
  return c.html(layout("Omnisearch", content, { q }));
});

pageRoutes.get("/", async (c) => {
  const { q, programme, source, page } = c.req.query();
  const pageNum = page ? Number(page) : 1;
  const { items, total, pageSize } = await listShows({
    q,
    programme,
    source,
    page: pageNum,
  });
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (programme) qs.set("programme", programme);
  if (source) qs.set("source", source);
  const base = `/?${qs.toString()}${qs.toString() ? "&" : ""}`;

  const content = (
    <section>
      <h1>{programme ?? "Nejnovější pořady"}</h1>
      <p class="result-count">{total} pořadů</p>
      <ShowGrid items={items} />
      <Pagination page={pageNum} pageSize={pageSize} total={total} base={base} />
    </section>
  );
  return c.html(layout(programme ?? "Pořady", content, { q }));
});

pageRoutes.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const pageNum = c.req.query("page") ? Number(c.req.query("page")) : 1;
  const { items, total, pageSize } = await listShows({ q, page: pageNum });
  const content = (
    <section>
      <h1>Výsledky hledání</h1>
      <p class="result-count">
        {total} výsledků pro „{q}"
      </p>
      <ShowGrid items={items} />
      <Pagination
        page={pageNum}
        pageSize={pageSize}
        total={total}
        base={`/search?q=${encodeURIComponent(q)}&`}
      />
    </section>
  );
  return c.html(layout(`Hledání: ${q}`, content, { q }));
});

pageRoutes.get("/programme/:name", async (c) => {
  const programme = decodeURIComponent(c.req.param("name"));
  const pageNum = c.req.query("page") ? Number(c.req.query("page")) : 1;
  const { items, total, pageSize } = await listShows({ programme, page: pageNum });
  const content = (
    <section>
      <h1>{programme}</h1>
      <p class="result-count">{total} dílů</p>
      <ShowGrid items={items} />
      <Pagination
        page={pageNum}
        pageSize={pageSize}
        total={total}
        base={`/programme/${encodeURIComponent(programme)}?`}
      />
    </section>
  );
  return c.html(layout(programme, content));
});

pageRoutes.get("/programmes", async (c) => {
  const programmes = await listProgrammes();
  const content = (
    <section>
      <h1>Pořady</h1>
      <ul class="programme-list">
        {programmes.map((p) => (
          <li>
            <a href={`/programme/${encodeURIComponent(p.programme ?? "")}`}>{p.programme}</a>
            <span class="programme-list__count">{p.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
  return c.html(layout("Pořady", content));
});

pageRoutes.get("/show/:slug", async (c) => {
  const show = await getShowBySlug(c.req.param("slug"));
  if (!show) return c.html(layout("Nenalezeno", <section><h1>Pořad nenalezen</h1></section>), 404);

  const playable = show.audio.find((a) => a.streamable && a.streamUrl);
  const content = (
    <article class="show-detail">
      {show.artworkUrl ? (
        <img class="show-detail__art" src={show.artworkUrl} alt="" />
      ) : null}
      <div class="show-detail__body">
        {show.showName ? (
          <a class="show-detail__programme" href={`/programme/${encodeURIComponent(show.showName)}`}>
            {show.showName}
          </a>
        ) : null}
        <h1>{show.title}</h1>
        <p class="show-detail__meta">
          {formatDate(show.publishedAt)}
          {show.durationSec ? ` · ${formatDuration(show.durationSec)}` : ""}
        </p>

        {playable ? (
          <audio class="player" controls preload="none" src={playable.streamUrl!}></audio>
        ) : (
          <p class="notice">Audio se zpracovává…</p>
        )}

        {show.people.length ? (
          <p class="show-detail__people">{show.people.map((p) => p.name).join(", ")}</p>
        ) : null}
        {show.description ? (
          <p class="show-detail__desc">{stripHtml(show.description)}</p>
        ) : null}

        {playable?.cid ? (
          <p class="show-detail__cid">
            IPFS: <code>{playable.cid}</code>
          </p>
        ) : null}
      </div>
    </article>
  );
  return c.html(layout(show.title, content));
});
