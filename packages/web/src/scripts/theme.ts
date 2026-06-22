// Theme switcher: System → Light → Dark (cycle). "System" follows the OS via CSS
// (@media prefers-color-scheme) by leaving data-theme unset; an explicit choice sets
// data-theme on <html> and persists. A pre-paint inline script in Base.astro applies
// the stored choice before first paint (no flash); this wires the toggle + live updates.

const KEY = "rozhlas:theme";
type Pref = "system" | "light" | "dark";

const darkMQ = window.matchMedia?.("(prefers-color-scheme: dark)");

function readPref(): Pref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function effectiveDark(p: Pref): boolean {
  return p === "dark" || (p === "system" && !!darkMQ?.matches);
}

const LABELS: Record<Pref, { icon: string; title: string; aria: string }> = {
  system: { icon: "◐", title: "Motiv: podle systému", aria: "Motiv: podle systému. Přepnout na světlý." },
  light: { icon: "☀", title: "Motiv: světlý", aria: "Motiv: světlý. Přepnout na tmavý." },
  dark: { icon: "☾", title: "Motiv: tmavý", aria: "Motiv: tmavý. Přepnout podle systému." },
};

function apply(p: Pref): void {
  const root = document.documentElement;
  if (p === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = p;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", effectiveDark(p) ? "#161616" : "#ffffff");
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    const l = LABELS[p];
    btn.textContent = l.icon;
    btn.setAttribute("title", l.title);
    btn.setAttribute("aria-label", l.aria);
  }
}

export function initTheme(): void {
  apply(readPref());
  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const cur = readPref();
    const next: Pref = cur === "system" ? "light" : cur === "light" ? "dark" : "system";
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* private mode — still apply for this session */
    }
    apply(next);
  });
  // While following the OS, reflect live OS theme changes (and keep theme-color synced).
  darkMQ?.addEventListener?.("change", () => {
    if (readPref() === "system") apply("system");
  });
}
