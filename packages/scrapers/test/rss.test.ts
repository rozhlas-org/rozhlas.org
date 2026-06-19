import { test, expect } from "bun:test";
import { parsePodcastFeed, parseDuration, directAudioUrl } from "../src/iradio/rss.ts";

test("parseDuration handles seconds and clock formats", () => {
  expect(parseDuration("254")).toBe(254);
  expect(parseDuration("4:14")).toBe(254);
  expect(parseDuration("01:00:00")).toBe(3600);
  expect(parseDuration(undefined)).toBeUndefined();
});

test("directAudioUrl strips the podtrac redirect", () => {
  expect(
    directAudioUrl("https://dts.podtrac.com/redirect.mp3/portal.rozhlas.cz/a.mp3"),
  ).toBe("https://portal.rozhlas.cz/a.mp3");
  expect(directAudioUrl("https://portal.rozhlas.cz/b.mp3")).toBe(
    "https://portal.rozhlas.cz/b.mp3",
  );
});

test("parsePodcastFeed decodes entities and extracts media", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <title>Vybrali</title><language>cs</language>
    <item>
      <title>L&amp;#xE9;to</title>
      <guid>g1</guid>
      <pubDate>Wed, 18 Jun 2026 12:31:00 +0200</pubDate>
      <itunes:duration>4:14</itunes:duration>
      <enclosure url="https://dts.podtrac.com/redirect.mp3/portal.rozhlas.cz/a.mp3" type="audio/mpeg" length="100"/>
    </item>
  </channel></rss>`;
  const eps = parsePodcastFeed(xml);
  expect(eps).toHaveLength(1);
  const e = eps[0]!;
  expect(e.title).toBe("Léto");
  expect(e.showName).toBe("Vybrali");
  expect(e.durationSec).toBe(254);
  expect(e.sourceId).toBe("g1");
  expect(e.media).toEqual({ kind: "file", url: "https://portal.rozhlas.cz/a.mp3" });
});

test("parsePodcastFeed skips items without audio", () => {
  const xml = `<?xml version="1.0"?><rss><channel><title>X</title>
    <item><title>no audio</title><guid>g</guid></item>
  </channel></rss>`;
  expect(parsePodcastFeed(xml)).toHaveLength(0);
});
