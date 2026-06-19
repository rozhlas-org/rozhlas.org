import { defineConfig } from "astro/config";

// Static SPA hosted on GitHub Pages at the apex domain.
// All data is fetched client-side from the API (api.rozhlas.org), so the build
// carries no DB content and never goes stale. The fixed routes below are emitted
// as real pages (HTTP 200); deep links (/show/:slug, /programme/:name) resolve
// via the generated 404.html fallback (see src/pages/404.astro), which loads the
// same shell and lets the client router render the right view.
export default defineConfig({
  site: "https://rozhlas.org",
  output: "static",
});
