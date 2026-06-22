import type { Scraper } from "./types.ts";
import { iradioScraper } from "./iradio/index.ts";
import { cetbaScraper } from "./cetba/index.ts";
import { waveAudiobooksScraper } from "./wave/index.ts";
import { pohadkaScraper } from "./pohadka/index.ts";
import { juniorPribehyScraper } from "./junior/index.ts";
import { poctenickoScraper } from "./poctenicko/index.ts";
import { historiePlusScraper } from "./historie-plus/index.ts";
import { pribehyKalendareScraper } from "./pribehy-kalendare/index.ts";
import { hraNaSobotuScraper } from "./hra-na-sobotu/index.ts";
import { hraNaNedeliScraper } from "./hra-na-nedeli/index.ts";
import { pribehy20StoletiScraper } from "./pribehy-20-stoleti/index.ts";
import { osudoveZenyScraper } from "./osudove-zeny/index.ts";
import { historieZlocinuScraper } from "./historie-zlocinu/index.ts";
import { zednariScraper } from "./zednari/index.ts";
import { jihoceskaVlastivedaScraper } from "./jihoceska-vlastiveda/index.ts";
import { tadyToZnamScraper } from "./tady-to-znam/index.ts";
import { toulkyPrvniRepublikouScraper } from "./toulky-prvni-republikou/index.ts";
import { ziliByliScraper } from "./zili-byli/index.ts";
import { coVUcebnicichNebyloScraper } from "./co-v-ucebnicich-nebylo/index.ts";

/** page-key → strategy. Register new sources here (PLAN §5). */
export const SCRAPERS: Record<string, Scraper> = {
  [cetbaScraper.key]: cetbaScraper, // četba/literature (Vltava)
  [pohadkaScraper.key]: pohadkaScraper, // pohádky — fairy tales (Dvojka)
  [juniorPribehyScraper.key]: juniorPribehyScraper, // příběhy a pohádky (Rádio Junior)
  [poctenickoScraper.key]: poctenickoScraper, // Počteníčko — serialized readings
  [historiePlusScraper.key]: historiePlusScraper, // Historie Plus
  [pribehyKalendareScraper.key]: pribehyKalendareScraper, // Příběhy z kalendáře
  [hraNaSobotuScraper.key]: hraNaSobotuScraper, // Hra na sobotu — Saturday radio drama
  [hraNaNedeliScraper.key]: hraNaNedeliScraper, // Hra na neděli
  [pribehy20StoletiScraper.key]: pribehy20StoletiScraper, // Příběhy 20. století
  [osudoveZenyScraper.key]: osudoveZenyScraper, // Osudové ženy
  [historieZlocinuScraper.key]: historieZlocinuScraper, // Historie českého zločinu
  [zednariScraper.key]: zednariScraper, // Zednáři
  [jihoceskaVlastivedaScraper.key]: jihoceskaVlastivedaScraper, // Jihočeská vlastivěda (transcribe off)
  [tadyToZnamScraper.key]: tadyToZnamScraper, // Tady to znám (transcribe off)
  [toulkyPrvniRepublikouScraper.key]: toulkyPrvniRepublikouScraper, // Toulky první republikou (transcribe off)
  [ziliByliScraper.key]: ziliByliScraper, // ŽiliByli (transcribe off)
  [coVUcebnicichNebyloScraper.key]: coVUcebnicichNebyloScraper, // Co v učebnicích nebylo (transcribe off)
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
