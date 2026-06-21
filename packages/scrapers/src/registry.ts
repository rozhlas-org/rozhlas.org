import type { Scraper } from "./types.ts";
import { iradioScraper } from "./iradio/index.ts";
import { cetbaScraper } from "./cetba/index.ts";
import { waveAudiobooksScraper } from "./wave/index.ts";
import { pohadkaScraper } from "./pohadka/index.ts";
import { juniorPribehyScraper } from "./junior/index.ts";
import { poctenickoScraper } from "./poctenicko/index.ts";

/** page-key → strategy. Register new sources here (PLAN §5). */
export const SCRAPERS: Record<string, Scraper> = {
  [cetbaScraper.key]: cetbaScraper, // četba/literature (Vltava)
  [pohadkaScraper.key]: pohadkaScraper, // pohádky — fairy tales (Dvojka)
  [juniorPribehyScraper.key]: juniorPribehyScraper, // příběhy a pohádky (Rádio Junior)
  [poctenickoScraper.key]: poctenickoScraper, // Počteníčko — serialized readings
  [waveAudiobooksScraper.key]: waveAudiobooksScraper, // audiobooks (Radio Wave)
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
