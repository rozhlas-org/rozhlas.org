import { html, raw } from "hono/html";

/** Full HTML document shell. `content` is a rendered JSX node. */
export function layout(title: string, content: unknown, opts: { q?: string } = {}) {
  return html`<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} — rozhlas.org</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <header class="site-header">
      <a class="site-header__brand" href="/">rozhlas.org</a>
      <nav class="site-nav">
        <a href="/programmes">Pořady</a>
        <a href="/?source=iradio">Archiv</a>
        <a href="/omnisearch">Omnisearch</a>
      </nav>
      <form class="search" action="/search" method="get" role="search">
        <input
          type="search"
          name="q"
          value="${opts.q ?? ""}"
          placeholder="Hledat četbu, autora, pořad…"
          aria-label="Hledat"
        />
        <button type="submit">Hledat</button>
      </form>
    </header>
    <main class="site-main">${raw(String(content))}</main>
    <footer class="site-footer">
      <p>Archiv pořadů Českého rozhlasu · audio přes IPFS · zaměřeno na četbu a čtení.</p>
    </footer>
  </body>
</html>`;
}
