// View renderers — ported from packages/api/src/routes/pages.tsx + views/ui.tsx.
// Each exported view is async: it fetches from the API and returns an HTML string
// (plus the document <title>). The router in app.ts swaps the result into #app.

import { api, type CategoryGroup, type ListResult, type Selection, type ShowListItem, type SortKey, type TranscriptHit } from "./api.ts";
import { attr, esc, formatDate, formatDuration, stripHtml } from "./format.ts";
import { getProgress } from "./progress.ts";
import { getHistory, logView, type HistoryEntry } from "./history.ts";
import { getFavourites, isFavourite, refreshFavourite, type FavItem } from "./favourites.ts";
import { getSavedShow, savedToDetail, listSavedShows, fmtBytes, type SavedShow } from "./offline.ts";
import { applyPartMarquees } from "./player.ts";

export interface ViewResult {
  title: string;
  html: string;
}

/**
 * Add-to-queue button. player.ts reads the data attributes:
 *   - no `data-idx`  → "add all": fetch the show and queue every streamable díl.
 *   - with `data-idx`→ add just that one díl (`data-parttitle` is its row label).
 * `data-title`/`data-showname` carry the show meta for the queue entry.
 */
function queueAddBtn(
  slug: string,
  title: string,
  showName: string | null,
  opts: {
    label?: string;
    cls?: string;
    title?: string;
    idx?: string | number;
    partTitle?: string;
    artworkUrl?: string | null;
  } = {},
): string {
  const t = opts.title ?? "Přidat do fronty";
  const idxAttr = opts.idx != null ? ` data-idx="${attr(String(opts.idx))}"` : "";
  const ptAttr = opts.partTitle != null ? ` data-parttitle="${attr(opts.partTitle)}"` : "";
  // Carried into the queue entry so the Fronta row can show a cover thumbnail.
  const artAttr = opts.artworkUrl ? ` data-artwork="${attr(opts.artworkUrl)}"` : "";
  return `<button class="queue-add${opts.cls ? ` ${opts.cls}` : ""}" type="button"
    data-slug="${attr(slug)}" data-title="${attr(title)}" data-showname="${attr(showName ?? "")}"${idxAttr}${ptAttr}${artAttr}
    aria-label="${attr(t)}" title="${attr(t)}">${opts.label ?? "＋"}</button>`;
}

/** cs-CZ plural of "díl" (part): 1 díl · 2–4 díly · 0/5+ dílů. */
function dilWord(n: number): string {
  if (n === 1) return "díl";
  if (n >= 2 && n <= 4) return "díly";
  return "dílů";
}

/**
 * Queue-add button text + tooltip for a show with `n` streamable parts. Adding a
 * show queues all its parts (the player auto-advances through them), so multi-part
 * shows advertise the count. `compact` = the card pill ("Vše do fronty (N)");
 * otherwise the longer detail label ("Přidat do fronty (N dílů)"). The
 * parenthesized count sidesteps Czech case agreement (no "všech N dílů").
 */
function queueAddLabel(n: number, opts: { compact?: boolean } = {}): { label: string; title: string } {
  if (n > 1) {
    const title = `Přidat do fronty (${n} ${dilWord(n)})`;
    return { label: opts.compact ? `＋ Vše do fronty (${n})` : `＋ ${title}`, title };
  }
  return { label: opts.compact ? "＋" : "＋ Přidat do fronty", title: "Přidat do fronty" };
}

/**
 * A universal-search transcript match on a card: same `.tx-hit` button as the
 * přepisy page (player.ts handles the click), so it plays the díl at the timestamp.
 * `snippet` is pre-highlighted safe HTML from the API.
 */
function cardTxHit(s: ShowListItem): string {
  const h = s.transcriptHit!;
  const part = h.partIdx == null ? "single" : String(h.partIdx);
  const dil = h.partIdx == null ? "" : `<span class="tx-hit__dil">${h.partIdx}. díl</span>`;
  return `<button class="tx-hit tx-hit--card" type="button" data-slug="${attr(s.slug)}" data-part="${attr(part)}" data-seek="${h.startSec}" aria-label="Přehrát od ${esc(formatDuration(h.startSec))}"><span class="tx-hit__time">▶ ${esc(formatDuration(h.startSec))}</span>${dil}<span class="tx-hit__snip">${h.snippet}…</span></button>`;
}

function showCard(s: ShowListItem): string {
  const art = s.artworkUrl
    ? `<img src="${attr(s.artworkUrl)}" alt="" loading="lazy" />`
    : `<div class="show-card__art--placeholder" aria-hidden="true"></div>`;
  // Multi-part shows keep audio on their parts, so show-level `streamable` is
  // false for them — count streamable parts to decide playability + the label.
  const n = (s.streamablePartCount ?? 0) || (s.streamable ? 1 : 0);
  const playable = n > 0;
  // The blue ▶ badge plays the show immediately (player.ts intercepts the click
  // before the card link navigates). role/tabindex make it keyboard-operable; it
  // stays a <span> because it lives inside the card's <a> (a <button> there is
  // invalid HTML and gets reparented by the browser).
  // Selection items can pin a specific díl: the badge/queue act on that díl, the card
  // carries a magenta "N. díl" tag, and the ★ is hidden (favourites are per whole show).
  const isPart = s.partIdx != null;
  const badge = playable
    ? `<span class="show-card__badge" role="button" tabindex="0" data-slug="${attr(s.slug)}"${
        isPart ? ` data-idx="${attr(String(s.partIdx))}"` : ""
      } aria-label="${isPart ? attr(`Přehrát ${s.partIdx}. díl`) : "Přehrát pořad"}">▶</span>`
    : "";
  const lbl = queueAddLabel(n, { compact: true });
  const add = !playable
    ? ""
    : isPart
      ? queueAddBtn(s.slug, s.title, s.showName, {
          cls: "show-card__add",
          idx: s.partIdx!,
          partTitle: s.partTitle ?? `${s.partIdx}. díl`,
          label: "＋",
          title: "Přidat díl do fronty",
          artworkUrl: s.artworkUrl,
        })
      : queueAddBtn(s.slug, s.title, s.showName, {
          cls: `show-card__add${n > 1 ? " show-card__add--multi" : ""}`,
          label: lbl.label,
          title: lbl.title,
          artworkUrl: s.artworkUrl,
        });
  const dilTag = isPart
    ? `<span class="show-card__dil" title="${attr(s.partTitle ?? "")}">${esc(`${s.partIdx}. díl`)}</span>`
    : "";
  const programme = s.showName
    ? `<a class="show-card__programme" href="/programme/${encodeURIComponent(s.showName)}">${esc(s.showName)}</a>`
    : "";
  const dur = s.durationSec
    ? `<span class="show-card__dur"> · ${esc(formatDuration(s.durationSec))}</span>`
    : "";
  // ★ save toggle at top-left (queue ＋ owns top-right). Reflects the saved state and
  // toggles it. A real <button>, sibling of the card <a> (never inside it).
  const fav = isPart ? "" : favBtn(s, { cls: "show-card__fav", variant: "card" });
  return `
    <article class="show-card">
      ${add}
      ${fav}
      <a class="show-card__link" href="/show/${encodeURIComponent(s.slug)}">
        <div class="show-card__art">${art}${badge}${dilTag}</div>
        <h3 class="show-card__title">${esc(s.title)}</h3>
      </a>
      ${programme}
      ${s.transcriptHit ? cardTxHit(s) : s.snippet ? `<p class="show-card__snippet">${s.snippet}</p>` : ""}
      <p class="show-card__meta">${esc(formatDate(s.publishedAt))}${dur}</p>
      ${statsLine(s.plays, s.displays)}
    </article>`;
}

/** Fields a favourite toggle needs to render a card later — a subset of ShowListItem. */
type FavCardData = Omit<FavItem, "addedAt">;

/**
 * "Oblíbené" save toggle. Carries every card field on `data-*` so favourites.ts can
 * store the show without refetching. `aria-pressed` reflects the saved state at render;
 * the click handler flips it in place. variant: detail = labelled pill, card = icon star.
 */
function favBtn(f: FavCardData, opts: { cls?: string; variant: "detail" | "card" }): string {
  const saved = isFavourite(f.slug);
  const label = opts.variant === "detail" ? (saved ? "★ V oblíbených" : "★ Do oblíbených") : "★";
  const t = saved ? "Odebrat z oblíbených" : "Přidat do oblíbených";
  return `<button class="fav-toggle${opts.cls ? ` ${opts.cls}` : ""}" type="button" aria-pressed="${saved}"
    data-slug="${attr(f.slug)}" data-title="${attr(f.title)}" data-showname="${attr(f.showName ?? "")}"
    data-source="${attr(f.source)}" data-artwork="${attr(f.artworkUrl ?? "")}"
    data-durationsec="${attr(f.durationSec == null ? "" : String(f.durationSec))}" data-publishedat="${attr(f.publishedAt ?? "")}"
    data-plays="${attr(String(f.plays))}" data-displays="${attr(String(f.displays))}"
    data-streamable="${f.streamable ? "1" : "0"}" data-streamableparts="${attr(String(f.streamablePartCount))}"
    aria-label="${attr(t)}" title="${attr(t)}">${label}</button>`;
}

/** Plays + displays counters (mono, muted). ▶ = přehrání, plus zobrazení. */
function statsLine(plays: number, displays: number): string {
  return `<p class="stats">
    <span class="stats__item" title="Přehrání">▶ ${plays}</span>
    <span class="stats__item" title="Zobrazení">${displays} zobrazení</span>
  </p>`;
}

/** Sort control — added (default, newest first) / plays / alphabet. */
function sortControl(current: SortKey, params: URLSearchParams): string {
  const opts: [SortKey, string][] = [
    ["added", "Nejnovější"],
    ["plays", "Nejpřehrávanější"],
    ["alpha", "Abecedně"],
  ];
  const links = opts
    .map(([key, label]) => {
      const p = new URLSearchParams(params);
      if (key === "added") p.delete("sort");
      else p.set("sort", key);
      p.delete("page");
      const qs = p.toString();
      const active = current === key ? " is-active" : "";
      return `<a class="sort__opt${active}" href="${attr(`/${qs ? `?${qs}` : ""}`)}">${esc(label)}</a>`;
    })
    .join("");
  return `<div class="sort"><span class="sort__label">Řadit</span>${links}</div>`;
}

function showGrid(items: ShowListItem[]): string {
  if (!items.length) return `<p class="empty">Žádné pořady.</p>`;
  return `<div class="show-grid">${items.map((s) => showCard(s)).join("")}</div>`;
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

/** Universal search box — hybrid semantic + keyword search across every show. */
function searchBox(q = "", heading: "h1" | "h2" = "h1"): string {
  return `
    <section class="mood">
      <${heading} class="mood__title">Univerzální vyhledávání</${heading}>
      <p class="omni__hint">Hledejte podle názvu, autora, tématu i obsahu — stačí napsat, co hledáte, klidně celou větou.</p>
      <form class="omni__form" action="/omnisearch" method="get">
        <input type="search" name="q" placeholder="Co hledáte?" value="${attr(q)}" />
        <button type="submit">Hledat</button>
      </form>
    </section>`;
}

export async function browseView(params: URLSearchParams): Promise<ViewResult> {
  const q = params.get("q") ?? undefined;
  const programme = params.get("programme") ?? undefined;
  const source = params.get("source") ?? undefined;
  const sortRaw = params.get("sort");
  const sort: SortKey = sortRaw === "plays" || sortRaw === "alpha" ? sortRaw : "added";
  const page = params.get("page") ? Number(params.get("page")) : 1;
  // Show the "Výběry" rail only on the bare main page (no filter/search/paging).
  const showRail = !q && !programme && !source && page === 1;
  const [data, sels] = await Promise.all([
    api.shows({ q, programme, source, sort, page }),
    showRail ? api.selections().catch(() => []) : Promise.resolve([]),
  ]);

  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (programme) qs.set("programme", programme);
  if (source) qs.set("source", source);
  if (sort !== "added") qs.set("sort", sort);
  const base = `/?${qs.toString()}${qs.toString() ? "&" : ""}`;

  const heading = programme ?? "Nejnovější pořady";
  const filter = `
    <form class="filter" action="/" method="get" role="search">
      <input class="filter__input" type="search" name="q" value="${attr(q ?? "")}"
        placeholder="Filtrovat…" aria-label="Filtrovat pořady" />
      ${source ? `<input type="hidden" name="source" value="${attr(source)}" />` : ""}
      ${sort !== "added" ? `<input type="hidden" name="sort" value="${attr(sort)}" />` : ""}
    </form>`;
  return {
    title: programme ?? "Pořady",
    html:
      searchBox("", "h2") +
      selectionsRail(sels) +
      `<section>
        <div class="browse__head">
          <h1>${esc(heading)}</h1>
          ${filter}
        </div>
        <div class="browse__bar">
          <p class="result-count">${esc(`${data.total} pořadů`)}</p>
          ${sortControl(sort, params)}
        </div>
        ${showGrid(data.items)}
        ${pagination(data.page, data.pageSize, data.total, base)}
      </section>`,
  };
}

/** "Výběry" rail on the main page — a horizontal row of editorial tiles. */
function selectionsRail(sels: Selection[]): string {
  if (!sels.length) return "";
  const tiles = sels
    .map(
      (s) => `
      <a class="vyber-tile" href="/vyber/${encodeURIComponent(s.slug)}">
        <div class="vyber-tile__art">${
          s.thumbnailUrl
            ? `<img src="${attr(s.thumbnailUrl)}" alt="" loading="lazy" />`
            : `<div class="vyber-tile__ph" aria-hidden="true"></div>`
        }</div>
        <h3 class="vyber-tile__title">${esc(s.title)}</h3>
        ${s.description ? `<p class="vyber-tile__desc">${esc(s.description)}</p>` : ""}
        <span class="vyber-tile__count">${s.itemCount} pořadů</span>
      </a>`,
    )
    .join("");
  return `
    <section class="vybery">
      <h2 class="vybery__title">Výběry</h2>
      <div class="vybery__rail">${tiles}</div>
    </section>`;
}

/** Dedicated page for one selection — its shows in the usual card grid. */
export async function selectionView(slug: string): Promise<ViewResult> {
  const sel = await api.selection(slug).catch(() => null);
  if (!sel) {
    return { title: "Nenalezeno", html: `<section><h1>Výběr nenalezen</h1><p><a href="/">← Výběry</a></p></section>` };
  }
  return {
    title: sel.title,
    html:
      `<section class="selection">` +
      `<p class="selection__back"><a href="/">← Výběry</a></p>` +
      `<h1>${esc(sel.title)}</h1>` +
      (sel.description ? `<p class="selection__desc">${esc(stripHtml(sel.description))}</p>` : "") +
      showGrid(sel.items) +
      `</section>`,
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

/** Category-group tiles (a wrapping grid) — the curated top of the Kategorie page. */
function categoryTiles(groups: CategoryGroup[]): string {
  if (!groups.length) return "";
  const tiles = groups
    .map(
      (g) => `
      <a class="vyber-tile vyber-tile--kat" href="/kategorie/${encodeURIComponent(g.slug)}">
        <div class="vyber-tile__art">${
          g.thumbnailUrl
            ? `<img src="${attr(g.thumbnailUrl)}" alt="" loading="lazy" />`
            : `<div class="vyber-tile__ph" aria-hidden="true"></div>`
        }</div>
        <h3 class="vyber-tile__title">${esc(g.title)}</h3>
        ${g.description ? `<p class="vyber-tile__desc">${esc(g.description)}</p>` : ""}
        <span class="vyber-tile__count">${g.showCount} pořadů</span>
      </a>`,
    )
    .join("");
  return `<div class="kat-grid">${tiles}</div>`;
}

export async function programmesView(): Promise<ViewResult> {
  const [programmes, groups] = await Promise.all([api.programmes(), api.categoryGroups().catch(() => [])]);
  const tiles = categoryTiles(groups);
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
    title: "Kategorie",
    html:
      `<section><h1>Kategorie</h1>` +
      tiles +
      (tiles ? `<h2 class="kat-subhead">Všechny pořady</h2>` : "") +
      `<ul class="programme-list">${items}</ul></section>`,
  };
}

/** Dedicated page for one category group — its shows across the grouped programmes. */
export async function categoryGroupView(slug: string, params: URLSearchParams): Promise<ViewResult> {
  const page = params.get("page") ? Number(params.get("page")) : 1;
  const grp = await api.categoryGroup(slug, page).catch(() => null);
  if (!grp) {
    return { title: "Nenalezeno", html: `<section><h1>Kategorie nenalezena</h1><p><a href="/programmes">← Kategorie</a></p></section>` };
  }
  const chips = grp.programmes
    .map((p) => `<a class="hist-chip" href="/programme/${encodeURIComponent(p)}">${esc(p)}</a>`)
    .join("");
  const base = `/kategorie/${encodeURIComponent(slug)}?`;
  return {
    title: grp.title,
    html:
      `<section class="selection">` +
      `<p class="selection__back"><a href="/programmes">← Kategorie</a></p>` +
      `<h1>${esc(grp.title)}</h1>` +
      (grp.description ? `<p class="selection__desc">${esc(stripHtml(grp.description))}</p>` : "") +
      (chips ? `<div class="kat-chips">${chips}</div>` : "") +
      showGrid(grp.items) +
      pagination(grp.page, grp.pageSize, grp.total, base) +
      `</section>`,
  };
}

// ---- Historie (local view/listen log) ----

const DAY = 86_400_000;

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayHeading(at: number): string {
  const k = dayKey(at);
  if (k === dayKey(Date.now())) return "Dnes";
  if (k === dayKey(Date.now() - DAY)) return "Včera";
  return new Date(at).toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

/** Filter chip as an <a> that sets one param and preserves the others. */
function histChip(label: string, key: string, val: string | null, current: string | null, params: URLSearchParams): string {
  const p = new URLSearchParams(params);
  if (val === null) p.delete(key);
  else p.set(key, val);
  const qs = p.toString();
  const active = (current ?? null) === val ? " is-active" : "";
  return `<a class="hist-chip${active}" href="/historie${qs ? `?${qs}` : ""}">${esc(label)}</a>`;
}

function historyRow(e: HistoryEntry): string {
  const badge =
    e.type === "listen"
      ? `<span class="hist__type hist__type--listen" title="Poslechnuto" aria-label="Poslechnuto">▶</span>`
      : `<span class="hist__type hist__type--view" title="Zobrazeno" aria-label="Zobrazeno">👁</span>`;
  const subParts = [e.showName, e.type === "listen" ? e.partTitle : null].filter(Boolean) as string[];
  const sub = subParts.length ? `<span class="hist__sub">${esc(subParts.join(" · "))}</span>` : "";
  return (
    `<li class="hist${e.type === "listen" ? " hist--listen" : ""}">` +
    `<span class="hist__time">${esc(clockTime(e.at))}</span>${badge}` +
    `<a class="hist__link" href="/show/${encodeURIComponent(e.slug)}">` +
    `<span class="hist__title">${esc(e.title)}</span>${sub}</a></li>`
  );
}

export async function historyView(params: URLSearchParams): Promise<ViewResult> {
  const all = getHistory();
  const type = params.get("type"); // "view" | "listen" | null(=vše)
  const range = params.get("range"); // "today" | "7d" | null(=vše)
  const since = range === "today" ? startOfToday() : range === "7d" ? Date.now() - 7 * DAY : 0;
  const items = all.filter((e) => e.at >= since && (type === "view" || type === "listen" ? e.type === type : true));

  const typeChips =
    histChip("Vše", "type", null, type, params) +
    histChip("Zobrazeno", "type", "view", type, params) +
    histChip("Poslechnuto", "type", "listen", type, params);
  const rangeChips =
    histChip("Vše", "range", null, range, params) +
    histChip("Dnes", "range", "today", range, params) +
    histChip("7 dní", "range", "7d", range, params);

  let list: string;
  if (!all.length) {
    list = `<p class="empty">Zatím žádná historie. Až si něco zobrazíte nebo pustíte, objeví se to tady. <a href="/">Procházet pořady →</a></p>`;
  } else if (!items.length) {
    list = `<p class="empty">Pro tento filtr nic není.</p>`;
  } else {
    let out = "";
    let lastDay = "";
    for (const e of items) {
      const k = dayKey(e.at);
      if (k !== lastDay) {
        if (lastDay) out += `</ol>`;
        out += `<h2 class="hist__day">${esc(dayHeading(e.at))}</h2><ol class="hist-list">`;
        lastDay = k;
      }
      out += historyRow(e);
    }
    out += `</ol>`;
    list = out;
  }

  const clear = all.length ? `<button class="history-clear" type="button">Vymazat historii</button>` : "";
  return {
    title: "Naposledy",
    html:
      `<section class="history">` +
      `<div class="history__head"><h1>Naposledy</h1>${clear}</div>` +
      `<div class="hist-filters"><span class="hist-filters__group">${typeChips}</span><span class="hist-filters__group">${rangeChips}</span></div>` +
      list +
      `<p class="history__privacy">Ukládá se jen ve vašem prohlížeči.</p>` +
      `</section>`,
  };
}

// ---- Oblíbené (saved shows) ----

export async function favouritesView(): Promise<ViewResult> {
  const favs = getFavourites();
  const clear = favs.length ? `<button class="history-clear fav-clear" type="button">Vymazat oblíbené</button>` : "";
  const body = favs.length
    ? showGrid(favs.map((f) => ({ ...f, streamUrl: null })))
    : `<p class="empty">Zatím nemáte žádné oblíbené pořady. Až si nějaký uložíte hvězdičkou ★, najdete ho tady. <a href="/">Procházet pořady →</a></p>`;
  return {
    title: "Oblíbené",
    html:
      `<section class="favourites">` +
      `<div class="history__head"><h1>Oblíbené</h1>${clear}</div>` +
      body +
      `<p class="history__privacy">Ukládá se jen ve vašem prohlížeči.</p>` +
      `</section>`,
  };
}

export async function omnisearchView(params: URLSearchParams): Promise<ViewResult> {
  const q = (params.get("q") ?? "").trim();
  const result = q ? await api.omnisearch(q) : null;
  const resultHtml = result
    ? result.items.length
      ? `<p class="result-count">${result.total} výsledků</p>${showGrid(result.items)}${
          result.hasMore
            ? `<div class="load-more"><button type="button" class="btn" data-omni-more` +
              ` data-q="${attr(q)}" data-offset="${result.items.length}">Načíst další</button></div>`
            : ""
        }`
      : `<p class="result-count">Nic jsme nenašli pro „${esc(q)}".</p>`
    : "";
  return {
    title: q ? `Hledání: ${q}` : "Univerzální vyhledávání",
    html: searchBox(q, "h1") + (resultHtml ? `<section class="omni">${resultHtml}</section>` : ""),
  };
}

let omniMoreWired = false;
/** "Load more" for omnisearch — append the next page of cards in place (the play/
 * queue/favourite handlers are delegated, so appended cards work; only the díl-title
 * marquees need re-wiring). Installed once at startup. */
export function wireOmniMore(): void {
  if (omniMoreWired) return;
  omniMoreWired = true;
  document.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest("[data-omni-more]") as HTMLButtonElement | null;
    if (!btn) return;
    const q = btn.dataset.q ?? "";
    const offset = Number(btn.dataset.offset) || 0;
    const grid = btn.closest(".omni")?.querySelector(".show-grid");
    if (!q || !grid) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Načítám…";
    try {
      const res = await api.omnisearch(q, offset);
      // Each page is a separate retrieval, so a boundary item can rarely repeat —
      // dedup against what's already on screen so the user never sees a duplicate.
      const shown = new Set(
        Array.from(grid.querySelectorAll<HTMLAnchorElement>("a.show-card__link")).map((a) =>
          a.getAttribute("href"),
        ),
      );
      const fresh = res.items.filter((s) => !shown.has(`/show/${encodeURIComponent(s.slug)}`));
      grid.insertAdjacentHTML("beforeend", fresh.map((s) => showCard(s)).join(""));
      applyPartMarquees();
      if (res.hasMore) {
        btn.dataset.offset = String(offset + res.items.length);
        btn.disabled = false;
        btn.textContent = label;
      } else {
        btn.closest(".load-more")?.remove();
      }
    } catch {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

export async function showView(slug: string): Promise<ViewResult> {
  let show = await api.show(slug).catch(() => null);
  if (!show) {
    // Offline: if the API is unreachable but the show is downloaded, render from it.
    const saved = await getSavedShow(slug).catch(() => null);
    if (saved) show = savedToDetail(saved);
  }
  if (!show) {
    return { title: "Nenalezeno", html: `<section><h1>Pořad nenalezen</h1></section>` };
  }
  api.recordDisplay(slug); // count this detail view (fire-and-forget)
  logView({ slug, title: show.title, showName: show.showName }); // local Historie (coalesced)
  const favData: FavCardData = {
    slug: show.slug,
    title: show.title,
    showName: show.showName,
    source: show.source,
    publishedAt: show.publishedAt,
    durationSec: show.durationSec,
    artworkUrl: show.artworkUrl,
    streamable: show.audio.some((a) => a.streamable),
    streamablePartCount: show.parts.filter((p) => p.audio?.streamable).length,
    plays: show.plays,
    displays: show.displays,
  };
  refreshFavourite(favData); // keep a saved show's stored card fields fresh (no-op if not saved)
  const hasParts = show.parts.length > 0;
  const art = show.artworkUrl ? `<img class="show-detail__art" src="${attr(show.artworkUrl)}" alt="" />` : "";
  const programme = show.showName
    ? `<a class="show-detail__programme" href="/programme/${encodeURIComponent(show.showName)}">${esc(show.showName)}</a>`
    : "";
  const meta = `${esc(formatDate(show.publishedAt))}${show.durationSec ? ` · ${esc(formatDuration(show.durationSec))}` : ""}${hasParts ? ` · ${show.parts.length} dílů` : ""}`;
  const people = show.people.length
    ? `<p class="show-detail__people">${esc(show.people.map((p) => p.name).join(", "))}</p>`
    : "";
  const desc = show.description
    ? `<p class="show-detail__desc">${esc(stripHtml(show.description))}</p>`
    : "";

  // Serialized show → díl list; each row hands its track to the shell player.
  let audioBlock: string;
  if (hasParts) {
    const items = show.parts
      .map((p) => {
        // Played state is read from localStorage at render time, so a reload
        // shows the right checkmarks/resume hints with no flash. progress.ts
        // keeps them live as you listen; player.ts marks the now-playing díl.
        const key = `${show.slug}#${p.idx}`;
        const prog = getProgress(key);
        const played = prog?.done ?? false;
        const resumeAt = !played && prog && prog.t > 1 ? prog.t : 0;
        // The whole row plays (player.ts delegates clicks on .part--playable);
        // data-slug/data-idx live on the row so the title is clickable too.
        const canPlay = p.audio?.streamable && p.audio.streamUrl;
        const play = canPlay
          ? `<button class="part__play" type="button" aria-label="Přehrát">▶</button>`
          : `<span class="notice">zpracovává se…</span>`;
        const check = `<span class="part__check" aria-hidden="true">✓</span>`;
        const num = `<span class="part__idx">${esc(String(p.idx))}.</span>`;
        const dur = p.durationSec ? `<span class="part__dur">${esc(formatDuration(p.durationSec))}</span>` : "";
        const resume = resumeAt
          ? `<span class="part__resume">pokračovat od ${esc(formatDuration(resumeAt))}</span>`
          : "";
        const cid = p.audio?.cid
          ? `<span class="part__cid">IPFS: <code>${esc(p.audio.cid)}</code></span>`
          : "";
        const cls = `part${played ? " part--played" : ""}${canPlay ? " part--playable" : ""}`;
        const data = canPlay ? ` data-slug="${attr(show.slug)}" data-idx="${attr(String(p.idx))}"` : "";
        // Per-díl "add to queue" (trailing) — distinct from the row's ▶ play.
        const addPart = canPlay
          ? queueAddBtn(show.slug, show.title, show.showName, {
              idx: p.idx,
              partTitle: p.title ?? `${p.idx}. díl`,
              title: "Přidat tento díl do fronty",
              cls: "queue-add--part",
              artworkUrl: show.artworkUrl,
            })
          : "";
        // idx + title share one line; the title clips and marquee-scrolls if long
        // (player.ts applies the scroll after render). dur/resume sit below. The
        // played ✓ sits inline at the line start (not a corner box) so it never
        // shifts the trailing ＋ — the row's cyan tint is the main "done" signal.
        const line = `<span class="part__line">${check}${num}<span class="part__title">${esc(p.title ?? "díl")}</span></span>`;
        return `<li class="${cls}"${data}>${play}${line}${dur}${resume}${cid}${addPart}</li>`;
      })
      .join("");
    audioBlock = `<ol class="parts">${items}</ol>`;
  } else {
    const playable = show.audio.find((a) => a.streamable && a.streamUrl);
    const singleDur = playable?.durationSec ?? show.durationSec;
    const singleDurEl = singleDur ? `<span class="part__dur">${esc(formatDuration(singleDur))}</span>` : "";
    audioBlock = playable
      ? `<div class="part part--single part--playable" data-slug="${attr(show.slug)}" data-idx="single"><button class="part__play" type="button" aria-label="Přehrát">▶</button><div class="part__body"><span class="part__title">${esc(show.title)}</span>${singleDurEl}</div></div>${
          playable.cid ? `<p class="show-detail__cid">IPFS: <code>${esc(playable.cid)}</code></p>` : ""
        }`
      : `<p class="notice">Audio se zpracovává…</p>`;
  }

  // "Přepis" — shown only when a transcript exists; lazy-loaded on toggle.
  const hasTranscript =
    show.parts.some((p) => p.audio?.hasTranscript) || show.audio.some((a) => a.hasTranscript);
  const transcriptSection = hasTranscript
    ? `<section class="transcript">
        <button class="transcript-toggle" type="button" data-slug="${attr(show.slug)}" aria-expanded="false">Zobrazit přepis</button>
        <div class="transcript-body" hidden></div>
      </section>`
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
          ${statsLine(show.plays, show.displays)}
          <div class="show-detail__actions">
          ${(() => {
            // Count streamable parts client-side from the loaded detail (no API
            // dependency). Adding the show queues ALL parts — the label says so.
            const nParts = show.parts.filter((p) => p.audio?.streamable).length;
            const n = nParts || (show.audio.some((a) => a.streamable) ? 1 : 0);
            if (n === 0) return "";
            const lbl = queueAddLabel(n);
            return queueAddBtn(show.slug, show.title, show.showName, {
              label: lbl.label,
              title: lbl.title,
              cls: "queue-add--detail",
              artworkUrl: show.artworkUrl,
            });
          })()}
          ${favBtn(favData, { cls: "fav-toggle--detail", variant: "detail" })}
          ${favData.streamable ? `<div class="offline" data-slug="${attr(show.slug)}"></div>` : ""}
          </div>
          ${desc}
          ${people}
          ${audioBlock}
          ${transcriptSection}
        </div>
      </article>
      <section class="similar" id="similar-mount" data-slug="${attr(show.slug)}" hidden>
        <h2 class="similar__title">Podobné pořady</h2>
        <div class="show-grid" id="similar-grid"></div>
      </section>`,
  };
}

/** One transcript-search result: show title + clickable timestamped snippets. */
function txResultCard(it: { show: ShowListItem; hits: TranscriptHit[] }): string {
  const s = it.show;
  const programme = s.showName
    ? `<a class="show-card__programme" href="/programme/${encodeURIComponent(s.showName)}">${esc(s.showName)}</a>`
    : "";
  const hits = it.hits
    .map((h) => {
      const part = h.partIdx == null ? "single" : String(h.partIdx);
      const dil = h.partIdx == null ? "" : `<span class="tx-hit__dil">${h.partIdx}. díl</span>`;
      return `<button class="tx-hit" type="button" data-slug="${attr(s.slug)}" data-part="${attr(part)}" data-seek="${h.startSec}" aria-label="Přehrát od ${esc(formatDuration(h.startSec))}">
        <span class="tx-hit__time">▶ ${esc(formatDuration(h.startSec))}</span>
        ${dil}
        <span class="tx-hit__snip">${esc(h.snippet)}…</span>
      </button>`;
    })
    .join("");
  return `<article class="tx-result">
    <a class="tx-result__title" href="/show/${encodeURIComponent(s.slug)}">${esc(s.title)}</a>
    ${programme}
    <div class="tx-hits">${hits}</div>
  </article>`;
}

/** "Hledat v přepisech" — full-text + semantic search inside the spoken content. */
export async function transcriptSearchView(params: URLSearchParams): Promise<ViewResult> {
  const q = (params.get("q") ?? "").trim();
  const result = q ? await api.transcriptSearch(q) : null;
  const body = result
    ? result.items.length
      ? `<p class="result-count">${result.items.length} pořadů · ${result.vectorHits} sémantických / ${result.ftsHits} klíčových shod</p>
         <div class="tx-results">${result.items.map(txResultCard).join("")}</div>`
      : `<p class="empty">V přepisech nic nenalezeno.</p>`
    : "";
  return {
    title: "Hledat v přepisech",
    html: `
      <section class="tx-search">
        <h1>Hledat v přepisech</h1>
        <p class="omni__hint">Prohledejte text namluvených pořadů — sémanticky i podle klíčových slov. Kliknutím na výsledek se přehraje přesně v daném místě.</p>
        <form class="omni__form" action="/transcripts" method="get">
          <input type="search" name="q" placeholder="Co hledáte v přepisu?" value="${attr(q)}" />
          <button type="submit">Hledat</button>
        </form>
        ${body}
      </section>`,
  };
}

/**
 * Lazily fill the "Podobné pořady" rail below a show detail. Called after the
 * router paints; fetches the cached /similar endpoint and reveals the section
 * only if it returns something. Purely additive — any failure leaves the detail
 * untouched. Guards against the user navigating away mid-fetch.
 */
export async function loadSimilar(): Promise<void> {
  const mount = document.getElementById("similar-mount");
  const slug = mount?.dataset.slug;
  if (!mount || !slug) return;
  let items: ShowListItem[] = [];
  try {
    items = await api.similar(slug);
  } catch {
    return; // additive — never break the detail view
  }
  // Bail if the view changed under us (different show, or navigated away).
  const live = document.getElementById("similar-mount");
  if (!live || live.dataset.slug !== slug || !items.length) return;
  const grid = live.querySelector<HTMLElement>("#similar-grid");
  if (!grid) return;
  grid.innerHTML = items.map((s) => showCard(s)).join("");
  live.hidden = false;
}

/** One downloaded show on the Stažené page (links to its detail, plays offline). */
function savedCard(s: SavedShow): string {
  const art = s.artworkUrl
    ? `<img src="${attr(s.artworkUrl)}" alt="" loading="lazy" />`
    : `<div class="show-card__art--placeholder" aria-hidden="true"></div>`;
  const programme = s.showName
    ? `<a class="show-card__programme" href="/programme/${encodeURIComponent(s.showName)}">${esc(s.showName)}</a>`
    : "";
  const n = s.parts.length;
  return `
    <article class="show-card saved-card">
      <button class="offline-toggle offline-toggle--ghost saved-card__remove" type="button" data-act="remove" data-slug="${attr(s.slug)}" aria-label="Odebrat ze stažených" title="Odebrat ze stažených">✕</button>
      <a class="show-card__link" href="/show/${encodeURIComponent(s.slug)}">
        <div class="show-card__art">${art}<span class="show-card__badge">▶</span></div>
        <h3 class="show-card__title">${esc(s.title)}</h3>
      </a>
      ${programme}
      <p class="show-card__meta">${n > 1 ? `${n} dílů · ` : ""}${esc(fmtBytes(s.totalBytes))} · offline</p>
    </article>`;
}

/** "Stažené" — shows downloaded to this device, playable with no network. */
export async function savedShowsView(): Promise<ViewResult> {
  const shows = await listSavedShows();
  const total = shows.reduce((sum, s) => sum + s.totalBytes, 0);
  const body = shows.length
    ? `<div class="show-grid">${shows.map(savedCard).join("")}</div>`
    : `<p class="empty">Zatím nemáte žádné stažené pořady.<br /><span class="queue__hint">Na stránce pořadu zvolte „Uložit offline“ — pak je přehrajete i bez připojení.</span></p>`;
  return {
    title: "Stažené",
    html: `<section>
      <h1>Stažené</h1>
      <p class="result-count">${shows.length ? `${shows.length} pořadů · ${esc(fmtBytes(total))} · k poslechu offline` : "k poslechu offline"}</p>
      ${body}
    </section>`,
  };
}
