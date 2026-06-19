import type { Scraper } from "./types.ts";
import { iradioScraper } from "./iradio/index.ts";
import { cetbaScraper } from "./cetba/index.ts";

/** page-key → strategy. Register new sources here (PLAN §5). */
export const SCRAPERS: Record<string, Scraper> = {
  [cetbaScraper.key]: cetbaScraper, // četba/literature (primary focus)
  [iradioScraper.key]: iradioScraper, // generic podcasts
};

export function getScraper(key: string): Scraper {
  const s = SCRAPERS[key];
  if (!s) throw new Error(`No scraper registered for key "${key}"`);
  return s;
}

export function listScrapers(): Scraper[] {
  return Object.values(SCRAPERS);
}
