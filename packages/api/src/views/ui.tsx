import type { ShowListItem } from "../queries.ts";

export function formatDuration(sec?: number | null): string {
  if (!sec || sec <= 0) return "";
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

export function formatDate(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
}

export function ShowCard({ s }: { s: ShowListItem }) {
  return (
    <article class="show-card">
      <a class="show-card__link" href={`/show/${s.slug}`}>
        <div class="show-card__art">
          {s.artworkUrl ? (
            <img src={s.artworkUrl} alt="" loading="lazy" />
          ) : (
            <div class="show-card__art--placeholder" aria-hidden="true" />
          )}
          {s.streamable ? <span class="show-card__badge">▶</span> : null}
        </div>
        <h3 class="show-card__title">{s.title}</h3>
      </a>
      {s.showName ? (
        <a class="show-card__programme" href={`/programme/${encodeURIComponent(s.showName)}`}>
          {s.showName}
        </a>
      ) : null}
      <p class="show-card__meta">
        {formatDate(s.publishedAt)}
        {s.durationSec ? <span class="show-card__dur"> · {formatDuration(s.durationSec)}</span> : null}
      </p>
    </article>
  );
}

export function ShowGrid({ items }: { items: ShowListItem[] }) {
  if (!items.length) return <p class="empty">Žádné pořady.</p>;
  return (
    <div class="show-grid">
      {items.map((s) => (
        <ShowCard s={s} />
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  base,
}: {
  page: number;
  pageSize: number;
  total: number;
  base: string; // e.g. "/?q=foo&" — ends with & or ?
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  const prev = page > 1 ? `${base}page=${page - 1}` : null;
  const next = page < pages ? `${base}page=${page + 1}` : null;
  return (
    <nav class="pagination" aria-label="Stránkování">
      {prev ? <a href={prev} rel="prev">← Předchozí</a> : <span class="disabled">← Předchozí</span>}
      <span class="pagination__status">
        {page} / {pages}
      </span>
      {next ? <a href={next} rel="next">Další →</a> : <span class="disabled">Další →</span>}
    </nav>
  );
}
