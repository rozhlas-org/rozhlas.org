// Client-side router for the static SPA. Reads location.pathname, fetches via the
// API client, and renders the matching view into #app. Internal <a> clicks and
// GET forms are intercepted for smooth navigation; everything also works on a
// hard reload because every deep path falls back to 404.html (same shell).

import {
  browseView,
  favouritesView,
  historyView,
  loadSimilar,
  omnisearchView,
  programmeView,
  programmesView,
  showView,
  transcriptSearchView,
  type ViewResult,
} from "./views.ts";
import { wireAudioProgress } from "./progress.ts";
import { clearHistory } from "./history.ts";
import { clearFavourites, toggleFavourite } from "./favourites.ts";
import { applyPartMarquees, initPlayer, syncNowPlaying } from "./player.ts";
import { wireTranscript } from "./transcript.ts";

const app = document.getElementById("app")!;

function decodeSeg(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function resolve(): Promise<ViewResult> {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(location.search);

  if (path === "/") return browseView(params);
  // /search retired → universal search lives at /omnisearch (keep old links working).
  if (path === "/search" || path === "/omnisearch") return omnisearchView(params);
  if (path === "/transcripts") return transcriptSearchView(params);
  if (path === "/programmes") return programmesView();
  if (path === "/historie") return historyView(params);
  if (path === "/oblibene") return favouritesView();

  const show = path.match(/^\/show\/(.+)$/);
  if (show) return showView(decodeSeg(show[1]));

  const programme = path.match(/^\/programme\/(.+)$/);
  if (programme) return programmeView(decodeSeg(programme[1]));

  return { title: "Nenalezeno", html: `<section><h1>Stránka nenalezena</h1></section>` };
}

function syncSearchInput() {
  const input = document.querySelector<HTMLInputElement>('.site-header .search input[name="q"]');
  if (input) input.value = new URLSearchParams(location.search).get("q") ?? "";
}

let token = 0;
async function render() {
  const mine = ++token;
  app.setAttribute("aria-busy", "true");
  syncSearchInput();
  try {
    const view = await resolve();
    if (mine !== token) return; // a newer navigation superseded this one
    document.title = `${view.title} — rozhlas.org`;
    app.innerHTML = view.html;
    syncNowPlaying(); // re-mark the now-playing díl in the freshly rendered view
    applyPartMarquees(); // scroll long díl titles right-to-left (like the player bar)
    window.scrollTo(0, 0);
    void loadSimilar(); // lazily fill "Podobné pořady" if this view has the mount
  } catch (err) {
    if (mine !== token) return;
    app.innerHTML = `<section><h1>Chyba</h1><p class="notice">Nepodařilo se načíst data. Zkuste to prosím znovu.</p></section>`;
    console.error(err);
  } finally {
    if (mine === token) app.removeAttribute("aria-busy");
  }
}

function navigate(url: string) {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) {
    location.href = url;
    return;
  }
  history.pushState({}, "", target.pathname + target.search);
  render();
}

// Intercept internal link clicks.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  const href = a.getAttribute("href");
  if (!href || a.target === "_blank" || a.hasAttribute("download")) return;
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) return; // external (e.g. IPFS gateway) — let it through
  e.preventDefault();
  navigate(url.pathname + url.search);
});

// Intercept GET forms (header search + omnisearch) for SPA navigation.
document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  if (form.method.toLowerCase() !== "get") return;
  const action = new URL(form.getAttribute("action") || "/", location.href);
  if (action.origin !== location.origin) return;
  e.preventDefault();
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [k, v] of data.entries()) if (typeof v === "string" && v.trim()) params.set(k, v);
  const qs = params.toString();
  navigate(action.pathname + (qs ? `?${qs}` : ""));
});

window.addEventListener("popstate", render);

// "Vymazat historii" on the /historie page (two-step confirm, then re-render).
document.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".history-clear, .fav-clear");
  if (!btn) return;
  if (btn.dataset.confirm === "1") {
    if (btn.classList.contains("fav-clear")) clearFavourites();
    else clearHistory();
    void render();
  } else {
    btn.dataset.confirm = "1";
    btn.textContent = "Opravdu vymazat?";
  }
});

// Save/unsave a show ("Oblíbené"). The button carries the card fields on data-*, so
// no fetch. On the detail page we flip the button in place (a re-render would restart
// the marquee / lose scroll); on the Oblíbené page we re-render so the card drops out.
document.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".fav-toggle");
  if (!btn) return;
  e.preventDefault();
  const d = btn.dataset;
  if (!d.slug) return;
  const nowFav = toggleFavourite({
    slug: d.slug,
    title: d.title ?? d.slug,
    showName: d.showname || null,
    source: d.source ?? "",
    publishedAt: d.publishedat || null,
    durationSec: d.durationsec ? Number(d.durationsec) : null,
    artworkUrl: d.artwork || null,
    streamable: d.streamable === "1",
    streamablePartCount: Number(d.streamableparts ?? "0"),
    plays: Number(d.plays ?? "0"),
    displays: Number(d.displays ?? "0"),
  });
  if (btn.classList.contains("show-card__fav")) {
    void render(); // Oblíbené page: reflect the removal (and the empty state)
    return;
  }
  btn.setAttribute("aria-pressed", String(nowFav));
  btn.textContent = nowFav ? "★ V oblíbených" : "★ Do oblíbených";
  const t = nowFav ? "Odebrat z oblíbených" : "Přidat do oblíbených";
  btn.setAttribute("aria-label", t);
  btn.setAttribute("title", t);
});

// (Play counting lives in player.ts now — it records once per track start using
// the playing track's slug, which is reliable across the single shared <audio>.)

// Mobile nav: it scrolls horizontally — show a chevron cue while there's more to
// the right, hide it once scrolled to the end (or when it all fits).
function initNav(): void {
  const nav = document.getElementById("site-nav");
  const wrap = nav?.parentElement;
  if (!nav || !wrap) return;
  const update = () => {
    const overflow = nav.scrollWidth - nav.clientWidth;
    wrap.classList.toggle("site-nav-wrap--scroll", overflow > 4);
    wrap.classList.toggle("site-nav-wrap--end", nav.scrollLeft >= overflow - 4);
  };
  nav.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  // Fonts load late and change widths; re-measure when they settle.
  document.fonts?.ready.then(update).catch(() => {});
  update();
}
initNav();

// Persist/restore per-díl playback progress (capture-phase, covers re-rendered audio).
wireAudioProgress();
// Persistent bottom player (lives in the shell, survives navigation).
initPlayer();
// Lazy "Přepis" disclosure on show detail pages.
wireTranscript();

render();
