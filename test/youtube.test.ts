import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { YouTube, YouTubeError, uploadsPlaylistId } from "../src/youtube.ts";

const CHANNEL = "UCDVYQ4Zhbm3S2dlz7P1GBDg";

/** A YouTube client answering from hand-written pages, recording each URL. */
function client(...bodies: unknown[]) {
  const asked: URL[] = [];
  const youtube = new YouTube({
    apiKey: "test-key",
    fetch: async (url) => {
      asked.push(new URL(url));
      const body = bodies.shift();
      return body instanceof Response ? body : Response.json(body);
    },
  });
  return { youtube, asked };
}

const playlistItem = (id: string, title: string, at: string) => ({
  snippet: { title },
  contentDetails: { videoId: id, videoPublishedAt: at },
});

describe("uploadsPlaylistId", () => {
  it("swaps the channel's UC for UU", () => {
    assert.equal(uploadsPlaylistId(CHANNEL), "UUDVYQ4Zhbm3S2dlz7P1GBDg");
  });
});

describe("playlistPage", () => {
  it("reads id, decoded title and publish time, skipping deleted videos", async () => {
    const { youtube, asked } = client({
      nextPageToken: "NEXT",
      items: [
        playlistItem(
          "YHo13wCIHT4",
          "Giants&#39; Highlights",
          "2026-10-05T01:00:00Z",
        ),
        {
          snippet: { title: "Deleted video" },
          contentDetails: { videoId: "gone0000000" },
        },
      ],
    });
    const page = await youtube.playlistPage("PLx", "TOKEN");
    assert.deepEqual(page, {
      nextPageToken: "NEXT",
      videos: [
        {
          youtubeId: "YHo13wCIHT4",
          title: "Giants' Highlights",
          publishedAt: "2026-10-05T01:00:00Z",
        },
      ],
    });
    assert.equal(asked[0]?.searchParams.get("playlistId"), "PLx");
    assert.equal(asked[0]?.searchParams.get("pageToken"), "TOKEN");
    assert.equal(youtube.unitsSpent, 1);
  });
});

describe("uploadsSince", () => {
  const page = (dates: string[], next?: string) => ({
    nextPageToken: next,
    items: dates.map((at, i) =>
      playlistItem(`vid${String(i).padStart(8, "0")}`, `clip ${at}`, at),
    ),
  });

  it("stops once a page reaches back past the cutoff", async () => {
    const { youtube, asked } = client(
      page(["2026-10-11T00:00Z", "2026-10-10T00:00Z"], "P2"),
      page(["2026-10-05T00:00Z", "2026-10-01T00:00Z"], "P3"),
    );
    const result = await youtube.uploadsSince(CHANNEL, "2026-10-04T00:00Z", 10);
    assert.equal(result.complete, true);
    assert.equal(result.videos.length, 4);
    assert.equal(asked.length, 2);
    assert.equal(
      asked[0]?.searchParams.get("playlistId"),
      "UUDVYQ4Zhbm3S2dlz7P1GBDg",
    );
  });

  it("reports an incomplete walk when the page budget runs out", async () => {
    const { youtube } = client(
      page(["2026-10-11T00:00Z"], "P2"),
      page(["2026-10-10T00:00Z"], "P3"),
    );
    const result = await youtube.uploadsSince(CHANNEL, "2026-09-01T00:00Z", 2);
    assert.equal(result.complete, false);
    assert.equal(youtube.unitsSpent, 2);
  });
});

describe("searchWindow", () => {
  it("searches the channel within the window and pages on", async () => {
    const { youtube, asked } = client(
      {
        nextPageToken: "P2",
        items: [
          {
            id: { videoId: "aaaaaaaaaaa" },
            snippet: {
              title: "Bills vs. Rams | Game Highlights",
              publishedAt: "2026-10-13T04:10:35Z",
            },
          },
        ],
      },
      {
        items: [
          {
            id: {},
            snippet: {
              title: "A playlist",
              publishedAt: "2026-10-13T04:00:00Z",
            },
          },
        ],
      },
    );
    const videos = await youtube.searchWindow(
      CHANNEL,
      "2026-10-13T00:15:00Z",
      "2026-10-13T12:15:00Z",
      "vs",
      3,
    );
    assert.deepEqual(
      videos.map((video) => video.youtubeId),
      ["aaaaaaaaaaa"],
    );
    const params = asked[0]!.searchParams;
    assert.equal(params.get("channelId"), CHANNEL);
    assert.equal(params.get("publishedAfter"), "2026-10-13T00:15:00Z");
    assert.equal(params.get("q"), "vs");
    assert.equal(asked[1]?.searchParams.get("pageToken"), "P2");
    assert.equal(youtube.unitsSpent, 200);
  });
});

describe("videos", () => {
  it("looks videos up 50 at a time, leaving out the ones taken down", async () => {
    const ids = Array.from(
      { length: 60 },
      (_, i) => `id${String(i).padStart(9, "0")}`,
    );
    const { youtube, asked } = client(
      {
        items: [
          {
            id: ids[0],
            snippet: {
              title: "Las Vegas Raiders vs. Patriots",
              publishedAt: "2026-10-06T01:00:00Z",
            },
          },
        ],
      },
      { items: [] },
    );
    const found = await youtube.videos(ids);
    assert.equal(asked.length, 2);
    assert.equal(asked[0]?.searchParams.get("id")?.split(",").length, 50);
    assert.deepEqual([...found.keys()], [ids[0]]);
    assert.equal(found.get(ids[0]!)?.title, "Las Vegas Raiders vs. Patriots");
  });
});

describe("errors", () => {
  it("names the status and endpoint but never the key", async () => {
    const { youtube } = client(new Response("quota", { status: 403 }));
    await assert.rejects(youtube.playlistPage("PLx"), (error: unknown) => {
      assert.ok(error instanceof YouTubeError);
      assert.equal(error.quotaExceeded, true);
      assert.doesNotMatch(error.message, /test-key/);
      return true;
    });
  });
});
