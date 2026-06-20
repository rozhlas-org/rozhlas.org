// Client-side router for the static SPA. Reads location.pathname, fetches via the
// API client, and renders the matching view into #app. Internal <a> clicks and
// GET forms are intercepted for smooth navigation; everything also works on a
// hard reload because every deep path falls back to 404.html (same shell).

import {
  browseView,
  historyView,
  loadSimilar,
  omnisearchView,
  programmeView,
  programmesView,
  searchView,
  showView,
  type ViewResult,
} from "./views.ts";
import { wireAudioProgress } from "./progress.ts";
import { clearHistory } from "./history.ts";
import { initPlayer, syncNowPlaying } from "./player.ts";

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
  if (path === "/search") return searchView(params);
  if (path === "/omnisearch") return omnisearchView(params);
  if (path === "/programmes") return programmesView();
  if (path === "/historie") return historyView(params);

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
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".history-clear");
  if (!btn) return;
  if (btn.dataset.confirm === "1") {
    clearHistory();
    void render();
  } else {
    btn.dataset.confirm = "1";
    btn.textContent = "Opravdu vymazat?";
  }
});

// (Play counting lives in player.ts now — it records once per track start using
// the playing track's slug, which is reliable across the single shared <audio>.)

// Persist/restore per-díl playback progress (capture-phase, covers re-rendered audio).
wireAudioProgress();
// Persistent bottom player (lives in the shell, survives navigation).
initPlayer();

render();
