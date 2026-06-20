import type { Scraper, ScrapeCtx, ScrapedShow, ScrapedPart, MediaSource } from "../types.ts";
import { iterateEpisodes, type ApiEpisode } from "./api.ts";
import { enumerateShows, type HubConfig } from "./hub.ts";

// API-based station source: fetches a show's episodes from the mujRozhlas JSON:API
// and groups them by `serial` into the same multi-part ScrapedShow shape the HTML
// crawler produced. sourceId is the stable serial/episode UUID (see the plan: the
// API doesn't expose the legacy node-id, so all API sources share the UUID namespace
// and cross-source dedup/mirror-skip works natively).

export interface ApiShowRef {
  uuid: string;
  /** Programme name (umbrella show), used as ScrapedShow.showName for browse filters. */
  name: string;
}
export interface ApiScraperConfig {
  key: string;
  title: string;
  schedule?: string;
  /** Explicit show UUIDs (single-programme sources like pohadka/wave). */
  shows?: ApiShowRef[];
  /** Or a category hub to enumerate show UUIDs from (cetba/junior). */
  hub?: HubConfig;
}

/** Episode duration from since/till (the API leaves `duration` null). */
function episodeDuration(ep: ApiEpisode): number | undefined {
  const { since, till } = ep.attributes;
  if (!since || !till) return undefined;
  const s = new Date(since).getTime();
  const t = new Date(till).getTime();
  if (Number.isNaN(s) || Number.isNaN(t) || t <= s) return undefined;
  return Math.round((t - s) / 1000);
}

/** Pick a playable manifest from an episode's audioLinks (prefer DASH, like the HTML path). */
function episodeMedia(ep: ApiEpisode): MediaSource | undefined {
  const links = ep.attributes.audioLinks ?? [];
  const dash = links.find((l) => l.url && /manifest\.mpd/i.test(l.url));
  const hls = links.find((l) => l.url && /\.m3u8/i.test(l.url));
  const pick = dash ?? hls ?? links.find((l) => l.url);
  if (!pick?.url) return undefined;
  return { kind: dash ? "dash" : hls ? "hls" : "file", url: pick.url };
}

interface SerialAcc {
  sourceId: string;
  showName: string;
  title: string;
  description?: string;
  descPart: number; // part number the description came from (prefer the earliest)
  publishedAt?: Date;
  artworkUrl?: string;
  parts: ScrapedPart[];
}

export function makeApiScraper(cfg: ApiScraperConfig): Scraper {
  return {
    key: cfg.key,
    title: cfg.title,
    schedule: cfg.schedule,

    async discover(ctx: ScrapeCtx): Promise<ScrapedShow[]> {
      const limit = ctx.limit ?? 50_000; // effectively "all" (watchdog/budget still bound a run)
      // Combine explicitly-listed shows with any hub-enumerated ones (a hub source can
      // also pin specific umbrella shows the hub crawl doesn't reach), deduped by uuid.
      const enumerated = cfg.hub ? await enumerateShows(ctx, cfg.hub) : [];
      const byUuid = new Map<string, ApiShowRef>();
      for (const s of [...(cfg.shows ?? []), ...enumerated]) byUuid.set(s.uuid, s);
      const shows = [...byUuid.values()];
      const serials = new Map<string, SerialAcc>();
      const standalone: ScrapedShow[] = [];
      let fetched = 0;
      let episodes = 0;
      const beat = () =>
        ctx.onProgress?.({ found: serials.size + standalone.length, fetched });

      for (const show of shows) {
        if (ctx.signal?.aborted) break;
        try {
          for await (const ep of iterateEpisodes(ctx, show.uuid, () => {
            fetched++;
            beat();
          })) {
            const media = episodeMedia(ep);
            if (!media) continue;
            episodes++;
            const a = ep.attributes;
            const since = a.since ? new Date(a.since) : undefined;
            const pub = since && !Number.isNaN(since.getTime()) ? since : undefined;
            const dur = episodeDuration(ep);
            const idx = a.part != null ? Number(a.part) : undefined;
            const serialId = ep.relationships?.serial?.data?.id;

            if (serialId) {
              let g = serials.get(serialId);
              if (!g) {
                g = {
                  sourceId: serialId,
                  showName: show.name,
                  title: a.mirroredSerial?.title ?? a.title ?? "(untitled)",
                  descPart: Infinity,
                  parts: [],
                };
                serials.set(serialId, g);
              }
              const partIdx = idx ?? g.parts.length + 1;
              g.parts.push({ idx: partIdx, title: a.title, durationSec: dur, media });
              // Serial-level description: take it from the earliest part that has one.
              if (a.description && partIdx < g.descPart) {
                g.description = a.description;
                g.descPart = partIdx;
              }
              if (pub && (!g.publishedAt || pub > g.publishedAt)) g.publishedAt = pub;
              if (!g.artworkUrl && a.asset?.url) g.artworkUrl = a.asset.url;
            } else {
              standalone.push({
                sourceId: ep.id,
                title: a.title ?? "(untitled)",
                description: a.description,
                showName: show.name,
                publishedAt: pub,
                durationSec: dur,
                artworkUrl: a.asset?.url,
                media,
                raw: { showUuid: show.uuid, episode: ep.id },
              });
            }
          }
        } catch (err) {
          if (ctx.signal?.aborted) break;
          ctx.log.warn("episodes fetch failed", { show: show.uuid, err: String(err) });
        }
        ctx.log.info("show done", { show: show.name, serials: serials.size, episodes });
      }

      const out: ScrapedShow[] = [
        ...[...serials.values()].map((g) => ({
          sourceId: g.sourceId,
          title: g.title,
          description: g.description,
          showName: g.showName,
          publishedAt: g.publishedAt,
          durationSec: g.parts.reduce((n, p) => n + (p.durationSec ?? 0), 0) || undefined,
          artworkUrl: g.artworkUrl,
          parts: g.parts.sort((a, b) => a.idx - b.idx),
          raw: { serial: g.sourceId, parts: g.parts.length },
        })),
        ...standalone,
      ];
      ctx.log.info("crawl done", { found: out.length, fetched, episodes });
      return out.slice(0, limit);
    },
  };
}
