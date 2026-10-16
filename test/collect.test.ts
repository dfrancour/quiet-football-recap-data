import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { VideoCache } from "../src/cache.ts";
import {
  collectGaps,
  collectIds,
  collectNewUploads,
  gapWindows,
  searchKey,
  type GapGame,
} from "../src/collect.ts";
import type { Video } from "../src/matcher.ts";
import { NFL_TEAMS } from "../src/nfl/teams.ts";
import { YouTube } from "../src/youtube.ts";

const CHANNEL = "UCDVYQ4Zhbm3S2dlz7P1GBDg";

const video = (youtubeId: string, title = youtubeId): Video => ({
  youtubeId,
  title,
  publishedAt: "2026-10-11T21:00:00Z",
});

const gap = (away: string, home: string, kickoff: string): GapGame => ({
  season: 2023,
  season_type: "regular",
  week: 8,
  away,
  home,
  kickoff,
});

/** A client whose every request answers with one search result. */
function searchingClient() {
  const asked: URL[] = [];
  const youtube = new YouTube({
    apiKey: "test-key",
    fetch: async (url) => {
      asked.push(new URL(url));
      return Response.json({
        items: [
          {
            id: { videoId: `v${String(asked.length).padStart(10, "0")}` },
            snippet: { title: "A vs B", publishedAt: "2023-10-29T21:00:00Z" },
          },
        ],
      });
    },
  });
  return { youtube, asked };
}

describe("VideoCache", () => {
  it("keeps first-seen order and the latest title", () => {
    const cache = new VideoCache();
    assert.equal(cache.add([video("a", "Los Vegas Raiders"), video("b")]), 2);
    assert.equal(cache.add([video("a", "Las Vegas Raiders")]), 0);
    assert.deepEqual(
      cache.videos.map((v) => `${v.youtubeId} ${v.title}`),
      ["a Las Vegas Raiders", "b b"],
    );
  });

  it("round-trips through disk, searches included", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "cache-")),
      "nested",
      "v.json",
    );
    const cache = new VideoCache();
    cache.add([video("a")]);
    cache.markSearched("vs|x|y");
    cache.write(path);
    const read = VideoCache.read(path);
    assert.deepEqual(read.videos, [video("a")]);
    assert.equal(read.searched("vs|x|y"), true);
  });

  it("starts empty when there is no file yet", () => {
    assert.deepEqual(VideoCache.read("/nonexistent/v.json").videos, []);
  });
});

describe("gapWindows", () => {
  const games = [
    gap("NO", "IND", "2023-10-29T17:00:00Z"),
    gap("KC", "DEN", "2023-10-29T20:25:00Z"),
    gap("LV", "DET", "2023-10-31T00:15:00Z"),
  ];

  it("searches overlapping windows once, for vs", () => {
    const windows = gapWindows(games, NFL_TEAMS, { hours: 12, perGame: false });
    assert.deepEqual(
      windows.map((w) => [w.after, w.before, w.query, w.games.length]),
      [
        ["2023-10-29T17:00:00.000Z", "2023-10-30T08:25:00.000Z", "vs", 2],
        ["2023-10-31T00:15:00.000Z", "2023-10-31T12:15:00.000Z", "vs", 1],
      ],
    );
  });

  it("gives each game its own search for both nicknames", () => {
    const windows = gapWindows(games, NFL_TEAMS, { hours: 12, perGame: true });
    assert.deepEqual(
      windows.map((w) => w.query),
      ["Saints Colts", "Chiefs Broncos", "Raiders Lions"],
    );
  });
});

describe("collectGaps", () => {
  const windows = gapWindows(
    [
      gap("NO", "IND", "2023-10-29T17:00:00Z"),
      gap("LV", "DET", "2023-10-31T00:15:00Z"),
      gap("SF", "CIN", "2023-11-05T21:05:00Z"),
    ],
    NFL_TEAMS,
    { hours: 12, perGame: false },
  );

  it("searches each window once and remembers it", async () => {
    const { youtube, asked } = searchingClient();
    const cache = new VideoCache();
    cache.markSearched(searchKey(windows[0]!));

    const result = await collectGaps(youtube, cache, CHANNEL, windows, {
      maxSearches: 10,
      pagesPerWindow: 1,
    });
    assert.deepEqual(result, { added: 2, windows: 2, skipped: 1 });
    assert.equal(asked.length, 2);
    assert.equal(
      asked[0]?.searchParams.get("publishedAfter"),
      windows[1]?.after,
    );
    assert.ok(windows.every((w) => cache.searched(searchKey(w))));
  });

  it("stops before spending past its cap", async () => {
    const { youtube, asked } = searchingClient();
    const result = await collectGaps(
      youtube,
      new VideoCache(),
      CHANNEL,
      windows,
      {
        maxSearches: 2,
        pagesPerWindow: 1,
      },
    );
    assert.equal(asked.length, 2);
    assert.equal(result.stopped, "2 searches");
  });
});

describe("collectIds", () => {
  it("adds the videos found and names the ones taken down", async () => {
    const youtube = new YouTube({
      apiKey: "test-key",
      fetch: async () =>
        Response.json({
          items: [
            {
              id: "aaaaaaaaaaa",
              snippet: {
                title: "#4: Broncos vs. Chiefs",
                publishedAt: "2015-09-18T05:12:05Z",
              },
            },
          ],
        }),
    });
    const cache = new VideoCache();
    const result = await collectIds(youtube, cache, [
      "aaaaaaaaaaa",
      "bbbbbbbbbbb",
    ]);
    assert.deepEqual(result, { added: 1, missing: ["bbbbbbbbbbb"] });
    assert.equal(cache.has("aaaaaaaaaaa"), true);
  });
});

describe("collectNewUploads", () => {
  /** Three pages of uploads, newest first, two videos each. */
  function uploadsClient() {
    const pages: string[] = [];
    const youtube = new YouTube({
      apiKey: "test-key",
      fetch: async (url) => {
        const token = new URL(url).searchParams.get("pageToken") ?? "0";
        pages.push(token);
        const page = Number(token);
        const item = (n: number) => ({
          snippet: { title: `video ${n}` },
          contentDetails: {
            videoId: `video${String(n).padStart(6, "0")}`,
            videoPublishedAt: `2026-10-${String(18 - n).padStart(2, "0")}T12:00:00Z`,
          },
        });
        return Response.json({
          items: [item(page * 2), item(page * 2 + 1)],
          nextPageToken: page < 2 ? String(page + 1) : undefined,
        });
      },
    });
    return { youtube, pages };
  }

  it("stops at the first page holding a video it already has", async () => {
    const { youtube, pages } = uploadsClient();
    const cache = new VideoCache();
    cache.add([video("video000003")]);
    const result = await collectNewUploads(
      youtube,
      cache,
      CHANNEL,
      "2026-01-01T00:00:00Z",
      10,
    );
    assert.deepEqual(pages, ["0", "1"]);
    assert.equal(result.added, 3);
  });

  it("stops at a video older than it needs, and at its page cap", async () => {
    const first = uploadsClient();
    await collectNewUploads(
      first.youtube,
      new VideoCache(),
      CHANNEL,
      "2026-10-17T18:00:00Z",
      10,
    );
    assert.deepEqual(first.pages, ["0"]);

    const capped = uploadsClient();
    const result = await collectNewUploads(
      capped.youtube,
      new VideoCache(),
      CHANNEL,
      "2026-01-01T00:00:00Z",
      2,
    );
    assert.deepEqual(capped.pages, ["0", "1"]);
    assert.equal(result.stopped, "read 2 pages");
  });
});
