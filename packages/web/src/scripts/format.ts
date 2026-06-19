// Formatting + escaping helpers. Ported from packages/api/src/views/ui.tsx.
// Everything that ends up in innerHTML must go through esc() — show titles,
// descriptions, people and programme names are untrusted third-party content.

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Safe value for an attribute that is itself inside a URL/encoded context. */
export function attr(s: unknown): string {
  return esc(s);
}

export function formatDuration(sec?: number | null): string {
  if (!sec || sec <= 0) return "";
  sec = Math.floor(sec); // positions are floats (audio.currentTime) — keep mm:ss clean
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Strip HTML tags to plain text (descriptions are untrusted third-party HTML). */
export function stripHtml(s?: string | null): string {
  if (!s) return "";
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatDate(d?: string | null): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
}
