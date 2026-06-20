// View renderers — ported from packages/api/src/routes/pages.tsx + views/ui.tsx.
// Each exported view is async: it fetches from the API and returns an HTML string
// (plus the document <title>). The router in app.ts swaps the result into #app.

import { api, type ListResult, type ShowListItem, type SortKey } from "./api.ts";
import { attr, esc, formatDate, formatDuration, stripHtml } from "./format.ts";
import { getProgress } from "./progress.ts";
import { getHistory, logView, type HistoryEntry } from "./history.ts";

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
  opts: { label?: string; cls?: string; title?: string; idx?: string | number; partTitle?: string } = {},
): string {
  const t = opts.title ?? "Přidat do fronty";
  const idxAttr = opts.idx != null ? ` data-idx="${attr(String(opts.idx))}"` : "";
  const ptAttr = opts.partTitle != null ? ` data-parttitle="${attr(opts.partTitle)}"` : "";
  return `<button class="queue-add${opts.cls ? ` ${opts.cls}` : ""}" type="button"
    data-slug="${attr(slug)}" data-title="${attr(title)}" data-showname="${attr(showName ?? "")}"${idxAttr}${ptAttr}
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

function showCard(s: ShowListItem): string {
  const art = s.artworkUrl
    ? `<img src="${attr(s.artworkUrl)}" alt="" loading="lazy" />`
    : `<div class="show-card__art--placeholder" aria-hidden="true"></div>`;
  // Multi-part shows keep audio on their parts, so show-level `streamable` is
  // false for them — count streamable parts to decide playability + the label.
  const n = (s.streamablePartCount ?? 0) || (s.streamable ? 1 : 0);
  const playable = n > 0;
  const badge = playable ? `<span class="show-card__badge">▶</span>` : "";
  const lbl = queueAddLabel(n, { compact: true });
  const add = playable
    ? queueAddBtn(s.slug, s.title, s.showName, {
        cls: `show-card__add${n > 1 ? " show-card__add--multi" : ""}`,
        label: lbl.label,
        title: lbl.title,
      })
    : "";
  const programme = s.showName
    ? `<a class="show-card__programme" href="/programme/${encodeURIComponent(s.showName)}">${esc(s.showName)}</a>`
    : "";
  const dur = s.durationSec
    ? `<span class="show-card__dur"> · ${esc(formatDuration(s.durationSec))}</span>`
    : "";
  return `
    <article class="show-card">
      ${add}
      <a class="show-card__link" href="/show/${encodeURIComponent(s.slug)}">
        <div class="show-card__art">${art}${badge}</div>
        <h3 class="show-card__title">${esc(s.title)}</h3>
      </a>
      ${programme}
      <p class="show-card__meta">${esc(formatDate(s.publishedAt))}${dur}</p>
      ${statsLine(s.plays, s.displays)}
    </article>`;
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

/** "Podle nálady" (omnisearch) entry box — natural-language mood search. */
function moodBox(q = "", heading: "h1" | "h2" = "h1"): string {
  return `
    <section class="mood">
      <${heading} class="mood__title">Podle nálady</${heading}>
      <p class="omni__hint">Popište náladu nebo situaci — třeba „jedu sám v noci a potřebuju něco napínavého" — a najdeme k tomu četbu.</p>
      <form class="omni__form" action="/omnisearch" method="get">
        <textarea name="q" rows="2" placeholder="Co máte chuť poslouchat?">${esc(q)}</textarea>
        <button type="submit">Najít</button>
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
  const data = await api.shows({ q, programme, source, sort, page });

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
      moodBox("", "h2") +
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
    title: "Kategorie",
    html: `<section><h1>Kategorie</h1><ul class="programme-list">${items}</ul></section>`,
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
    title: "Historie",
    html:
      `<section class="history">` +
      `<div class="history__head"><h1>Historie</h1>${clear}</div>` +
      `<div class="hist-filters"><span class="hist-filters__group">${typeChips}</span><span class="hist-filters__group">${rangeChips}</span></div>` +
      list +
      `<p class="history__privacy">Historie se ukládá jen ve vašem prohlížeči.</p>` +
      `</section>`,
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
    title: "Podle nálady",
    html: moodBox(q, "h1") + (resultHtml ? `<section class="omni">${resultHtml}</section>` : ""),
  };
}

export async function showView(slug: string): Promise<ViewResult> {
  const show = await api.show(slug).catch(() => null);
  if (!show) {
    return { title: "Nenalezeno", html: `<section><h1>Pořad nenalezen</h1></section>` };
  }
  api.recordDisplay(slug); // count this detail view (fire-and-forget)
  logView({ slug, title: show.title, showName: show.showName }); // local Historie (coalesced)
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
        const cls = `part${played ? " part--played" : ""}${canPlay ? " part--playable" : ""}`;
        const data = canPlay ? ` data-slug="${attr(show.slug)}" data-idx="${attr(String(p.idx))}"` : "";
        // Per-díl "add to queue" (trailing) — distinct from the row's ▶ play.
        const addPart = canPlay
          ? queueAddBtn(show.slug, show.title, show.showName, {
              idx: p.idx,
              partTitle: p.title ?? `${p.idx}. díl`,
              title: "Přidat tento díl do fronty",
              cls: "queue-add--part",
            })
          : "";
        // idx + title share one line; the title clips and marquee-scrolls if long
        // (player.ts applies the scroll after render). dur/resume sit below. The
        // played ✓ sits inline at the line start (not a corner box) so it never
        // shifts the trailing ＋ — the row's cyan tint is the main "done" signal.
        const line = `<span class="part__line">${check}${num}<span class="part__title">${esc(p.title ?? "díl")}</span></span>`;
        return `<li class="${cls}"${data}>${play}${line}${dur}${resume}${addPart}</li>`;
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
            });
          })()}
          ${desc}
          ${people}
          ${audioBlock}
        </div>
      </article>
      <section class="similar" id="similar-mount" data-slug="${attr(show.slug)}" hidden>
        <h2 class="similar__title">Podobné pořady</h2>
        <div class="show-grid" id="similar-grid"></div>
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
  grid.innerHTML = items.map(showCard).join("");
  live.hidden = false;
}
