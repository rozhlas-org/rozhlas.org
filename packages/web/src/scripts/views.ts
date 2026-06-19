// View renderers — ported from packages/api/src/routes/pages.tsx + views/ui.tsx.
// Each exported view is async: it fetches from the API and returns an HTML string
// (plus the document <title>). The router in app.ts swaps the result into #app.

import { api, type ListResult, type ShowListItem } from "./api.ts";
import { attr, esc, formatDate, formatDuration, stripHtml } from "./format.ts";

export interface ViewResult {
  title: string;
  html: string;
}

function showCard(s: ShowListItem): string {
  const art = s.artworkUrl
    ? `<img src="${attr(s.artworkUrl)}" alt="" loading="lazy" />`
    : `<div class="show-card__art--placeholder" aria-hidden="true"></div>`;
  const badge = s.streamable ? `<span class="show-card__badge">▶</span>` : "";
  const programme = s.showName
    ? `<a class="show-card__programme" href="/programme/${encodeURIComponent(s.showName)}">${esc(s.showName)}</a>`
    : "";
  const dur = s.durationSec
    ? `<span class="show-card__dur"> · ${esc(formatDuration(s.durationSec))}</span>`
    : "";
  return `
    <article class="show-card">
      <a class="show-card__link" href="/show/${encodeURIComponent(s.slug)}">
        <div class="show-card__art">${art}${badge}</div>
        <h3 class="show-card__title">${esc(s.title)}</h3>
      </a>
      ${programme}
      <p class="show-card__meta">${esc(formatDate(s.publishedAt))}${dur}</p>
    </article>`;
}

function showGrid(items: ShowListItem[]): string {
  if (!items.length) return `<p class="empty">Žádné pořady.</p>`;
  return `<div class="show-grid">${items.map(showCard).join("")}</div>`;
}

/** `base` ends with "&" or "?" — e.g. "/?q=foo&" or "/search?q=foo&". */
function pagination(page: number, pageSize: number, total: number, base: string): string {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return "";
  const prev =
    page > 1
      ? `<a href="${attr(base)}page=${page - 1}" rel="prev">← Předchozí</a>`
      : `<span class="disabled">← Předchozí</span>`;
  const next =
    page < pages
      ? `<a href="${attr(base)}page=${page + 1}" rel="next">Další →</a>`
      : `<span class="disabled">Další →</span>`;
  return `
    <nav class="pagination" aria-label="Stránkování">
      ${prev}
      <span class="pagination__status">${page} / ${pages}</span>
      ${next}
    </nav>`;
}

function listSection(heading: string, sub: string, data: ListResult, base: string): string {
  return `
    <section>
      <h1>${esc(heading)}</h1>
      <p class="result-count">${esc(sub)}</p>
      ${showGrid(data.items)}
      ${pagination(data.page, data.pageSize, data.total, base)}
    </section>`;
}

export async function browseView(params: URLSearchParams): Promise<ViewResult> {
  const q = params.get("q") ?? undefined;
  const programme = params.get("programme") ?? undefined;
  const source = params.get("source") ?? undefined;
  const page = params.get("page") ? Number(params.get("page")) : 1;
  const data = await api.shows({ q, programme, source, page });

  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (programme) qs.set("programme", programme);
  if (source) qs.set("source", source);
  const base = `/?${qs.toString()}${qs.toString() ? "&" : ""}`;

  const heading = programme ?? "Nejnovější pořady";
  return {
    title: programme ?? "Pořady",
    html: listSection(heading, `${data.total} pořadů`, data, base),
  };
}

export async function searchView(params: URLSearchParams): Promise<ViewResult> {
  const q = params.get("q") ?? "";
  const page = params.get("page") ? Number(params.get("page")) : 1;
  const data = await api.search(q, page);
  const base = `/search?q=${encodeURIComponent(q)}&`;
  return {
    title: `Hledání: ${q}`,
    html: `
      <section>
        <h1>Výsledky hledání</h1>
        <p class="result-count">${data.total} výsledků pro „${esc(q)}"</p>
        ${showGrid(data.items)}
        ${pagination(data.page, data.pageSize, data.total, base)}
      </section>`,
  };
}

export async function programmeView(name: string): Promise<ViewResult> {
  const page = new URLSearchParams(location.search).get("page");
  const data = await api.shows({ programme: name, page: page ? Number(page) : 1 });
  const base = `/programme/${encodeURIComponent(name)}?`;
  return {
    title: name,
    html: listSection(name, `${data.total} dílů`, data, base),
  };
}

export async function programmesView(): Promise<ViewResult> {
  const programmes = await api.programmes();
  const items = programmes
    .map(
      (p) => `
      <li>
        <a href="/programme/${encodeURIComponent(p.programme ?? "")}">${esc(p.programme)}</a>
        <span class="programme-list__count">${p.count}</span>
      </li>`,
    )
    .join("");
  return {
    title: "Pořady",
    html: `<section><h1>Pořady</h1><ul class="programme-list">${items}</ul></section>`,
  };
}

export async function omnisearchView(params: URLSearchParams): Promise<ViewResult> {
  const q = (params.get("q") ?? "").trim();
  const result = q ? await api.omnisearch(q) : null;
  const resultHtml = result
    ? `
      <p class="omni__intent">
        Hledám: <strong>${esc(result.intent.searchText)}</strong>
        ${result.intent.themes.length ? ` · témata: ${esc(result.intent.themes.join(", "))}` : ""}
        · intent: ${esc(result.intent.provider)} · ${result.vectorHits} sémantických / ${result.ftsHits} klíčových shod
      </p>
      ${showGrid(result.items)}`
    : "";
  return {
    title: "Omnisearch",
    html: `
      <section class="omni">
        <h1>Omnisearch</h1>
        <p class="omni__hint">Popište náladu nebo situaci — např. „jedu sám v noci a potřebuju něco napínavého".</p>
        <form class="omni__form" action="/omnisearch" method="get">
          <textarea name="q" rows="2" placeholder="Co máte chuť poslouchat?">${esc(q)}</textarea>
          <button type="submit">Najít</button>
        </form>
        ${resultHtml}
      </section>`,
  };
}

export async function showView(slug: string): Promise<ViewResult> {
  const show = await api.show(slug).catch(() => null);
  if (!show) {
    return { title: "Nenalezeno", html: `<section><h1>Pořad nenalezen</h1></section>` };
  }
  const playable = show.audio.find((a) => a.streamable && a.streamUrl);
  const art = show.artworkUrl ? `<img class="show-detail__art" src="${attr(show.artworkUrl)}" alt="" />` : "";
  const programme = show.showName
    ? `<a class="show-detail__programme" href="/programme/${encodeURIComponent(show.showName)}">${esc(show.showName)}</a>`
    : "";
  const meta = `${esc(formatDate(show.publishedAt))}${show.durationSec ? ` · ${esc(formatDuration(show.durationSec))}` : ""}`;
  const player = playable
    ? `<audio class="player" controls preload="none" src="${attr(playable.streamUrl)}"></audio>`
    : `<p class="notice">Audio se zpracovává…</p>`;
  const people = show.people.length
    ? `<p class="show-detail__people">${esc(show.people.map((p) => p.name).join(", "))}</p>`
    : "";
  const desc = show.description
    ? `<p class="show-detail__desc">${esc(stripHtml(show.description))}</p>`
    : "";
  const cid = playable?.cid
    ? `<p class="show-detail__cid">IPFS: <code>${esc(playable.cid)}</code></p>`
    : "";
  return {
    title: show.title,
    html: `
      <article class="show-detail">
        ${art}
        <div class="show-detail__body">
          ${programme}
          <h1>${esc(show.title)}</h1>
          <p class="show-detail__meta">${meta}</p>
          ${player}
          ${people}
          ${desc}
          ${cid}
        </div>
      </article>`,
  };
}
