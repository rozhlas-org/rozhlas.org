import type { APIRoute } from "astro";

// Static sitemap, generated at build time from the live API. Same-origin
// (rozhlas.org/sitemap.xml) so search engines accept the listed rozhlas.org URLs.
// Resilient: if the API is unreachable at build, emit the fixed routes only.
const SITE = "https://rozhlas.org";
const API = "https://api.rozhlas.org/api/sitemap-urls";
const STATIC = ["/", "/programmes", "/omnisearch", "/transcripts", "/oblibene", "/historie"];

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const GET: APIRoute = async () => {
  const urls: { loc: string; lastmod?: string }[] = STATIC.map((p) => ({ loc: SITE + p }));
  try {
    const res = await fetch(API, { signal: AbortSignal.timeout(45_000) });
    if (res.ok) {
      const data = (await res.json()) as {
        shows?: { slug: string; lastmod: string | null }[];
        programmes?: string[];
      };
      for (const s of data.shows ?? []) {
        urls.push({ loc: `${SITE}/show/${encodeURIComponent(s.slug)}`, lastmod: s.lastmod ?? undefined });
      }
      for (const name of data.programmes ?? []) {
        urls.push({ loc: `${SITE}/programme/${encodeURIComponent(name)}` });
      }
    } else {
      console.warn(`sitemap: API ${res.status}; emitting static URLs only`);
    }
  } catch (err) {
    console.warn("sitemap: API unreachable; emitting static URLs only", err);
  }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${xmlEscape(u.loc)}</loc>` +
          (u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : "") +
          `</url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
