import { XMLParser } from "fast-xml-parser";
import type { ScrapedShow } from "../types.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

/**
 * Decode HTML entities left in the text. rozhlas feeds double-encode (`&amp;#xE9;`),
 * so after the XML parser resolves `&amp;` we still get literal `&#xE9;` to decode.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

/** Coerce a value that may be a string or `{ "#text": ... }` to a (decoded) string. */
function asText(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return decodeEntities(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in v) return asText((v as any)["#text"]);
  return undefined;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Parse "HH:MM:SS", "MM:SS", or a plain seconds string into seconds. */
export function parseDuration(v: unknown): number | undefined {
  const s = asText(v);
  if (!s) return undefined;
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(":").map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Strip the podtrac tracking redirect to get the direct CDN url. */
export function directAudioUrl(url: string): string {
  const m = url.match(/\/redirect\.mp3\/(.+)$/);
  return m ? `https://${m[1]}` : url;
}

function pickImage(node: any): string | undefined {
  // itunes:image href, media:thumbnail url, or <image><url>
  return (
    node?.["itunes:image"]?.["@_href"] ??
    asText(node?.["media:thumbnail"]?.["@_url"]) ??
    asText(node?.image?.url) ??
    undefined
  );
}

/** Parse a rozhlas podcast RSS document into per-episode ScrapedShow records. */
export function parsePodcastFeed(xml: string): ScrapedShow[] {
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel;
  if (!channel) return [];

  const showName = asText(channel.title);
  const language = asText(channel.language);
  const channelImage = pickImage(channel);
  const categories = asArray(channel["itunes:category"])
    .map((c: any) => asText(c?.["@_text"]))
    .filter((x): x is string => !!x);
  const channelAuthor = asText(channel["itunes:author"]);

  const shows: ScrapedShow[] = [];
  for (const item of asArray<any>(channel.item)) {
    const enclosureUrl = asText(item.enclosure?.["@_url"]);
    if (!enclosureUrl) continue; // no audio → skip

    const guid = asText(item.guid) ?? enclosureUrl;
    const pubDateStr = asText(item.pubDate);
    const pubDate = pubDateStr ? new Date(pubDateStr) : undefined;
    const author = asText(item["itunes:author"]) ?? channelAuthor;

    shows.push({
      sourceId: guid,
      title: asText(item.title) ?? "(untitled)",
      description: asText(item.description) ?? asText(item["itunes:summary"]),
      showName,
      publishedAt: pubDate && !Number.isNaN(pubDate.getTime()) ? pubDate : undefined,
      durationSec: parseDuration(item["itunes:duration"]),
      language,
      people: author ? [{ name: author, role: "author" }] : undefined,
      categories: categories.length ? categories : undefined,
      artworkUrl: pickImage(item) ?? channelImage,
      media: { kind: "file", url: directAudioUrl(enclosureUrl) },
      raw: item,
    });
  }
  return shows;
}
