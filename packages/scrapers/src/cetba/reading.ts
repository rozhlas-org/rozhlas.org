import type { ScrapedShow, ScrapedPart } from "../types.ts";
import { decodeEntities, extractJsonArray, metaContent } from "../html.ts";

interface AudioLink {
  variant?: string; // "dash" | "hls"
  url?: string;
  duration?: number;
  bitrate?: number;
}
interface PlaylistItem {
  title?: string;
  part?: string;
  since?: string;
  duration?: number;
  audioLinks?: AudioLink[];
}

/** The trailing numeric id in a station URL (`/slug-12345678` → "12345678"). */
export function readingIdFromUrl(url: string): string | undefined {
  return url.match(/-(\d{5,})(?:[/?#].*)?$/)?.[1];
}

/** Trim station/site prefixes and suffixes from a page title. */
export function cleanTitle(t?: string): string | undefined {
  return t
    ?.replace(/^Český rozhlas\s+\S+\s*[|–—-]\s*/i, "") // "Český rozhlas Vltava | X" → "X"
    .replace(/\s*[|–—-]\s*(iROZHLAS\.cz|Vltava|Dvojka|Český rozhlas|mujRozhlas).*$/i, "")
    .trim();
}

/**
 * Parse a station reading page into a multi-part ScrapedShow. Returns null if the
 * page has no playable playlist (i.e. it's a listing/programme page, not a reading).
 */
export function parseReadingPage(
  html: string,
  url: string,
  programme?: string,
): ScrapedShow | null {
  const playlist = extractJsonArray<PlaylistItem>(html, "playlist");
  if (!playlist?.length) return null;

  const parts: ScrapedPart[] = [];
  for (let i = 0; i < playlist.length; i++) {
    const p = playlist[i]!;
    const dash = p.audioLinks?.find((a) => a.variant === "dash");
    const hls = p.audioLinks?.find((a) => a.variant === "hls");
    const link = dash ?? hls;
    if (!link?.url) continue;
    parts.push({
      idx: p.part ? Number(p.part) : i + 1,
      title: p.title ? decodeEntities(p.title) : undefined,
      durationSec: p.duration,
      media: { kind: dash ? "dash" : "hls", url: link.url },
    });
  }
  if (!parts.length) return null;

  const since = playlist[0]?.since ? new Date(playlist[0].since) : undefined;
  return {
    sourceId: readingIdFromUrl(url) ?? url,
    title: cleanTitle(metaContent(html, "og:title")) ?? "(untitled)",
    description: metaContent(html, "og:description"),
    showName: programme,
    publishedAt: since && !Number.isNaN(since.getTime()) ? since : undefined,
    durationSec: parts.reduce((a, p) => a + (p.durationSec ?? 0), 0) || undefined,
    artworkUrl: metaContent(html, "og:image"),
    parts,
    raw: { url, parts: parts.length },
  };
}
