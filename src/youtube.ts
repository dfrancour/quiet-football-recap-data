/**
 * Reads a channel's videos from the YouTube Data API: its uploads, its
 * playlists, a search within a time window, and a lookup by id. Every call
 * counts the quota units it spends, and the API key never appears in an
 * error or log.
 */

import { z } from "zod";
import { decodeHtmlEntities, type Video } from "./matcher.ts";

const API = "https://www.googleapis.com/youtube/v3";
const TIMEOUT_MS = 15_000;

/** Units each call costs, per page. */
export const QUOTA_UNITS = {
  playlists: 1,
  playlistItems: 1,
  search: 100,
  videos: 1,
} as const;

/** Every channel's uploads playlist is its id with `UC` swapped for `UU`. */
export function uploadsPlaylistId(channelId: string): string {
  return `UU${channelId.slice(2)}`;
}

const playlistItemsSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(
    z.object({
      snippet: z.object({ title: z.string().optional() }).optional(),
      contentDetails: z
        .object({
          videoId: z.string().optional(),
          videoPublishedAt: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

const playlistsSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({ title: z.string() }),
      contentDetails: z.object({ itemCount: z.number() }).optional(),
    }),
  ),
});

export interface Playlist {
  id: string;
  title: string;
  itemCount: number;
}

const searchSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(
    z.object({
      id: z.object({ videoId: z.string().optional() }),
      snippet: z.object({ title: z.string(), publishedAt: z.string() }),
    }),
  ),
});

const videosSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({ title: z.string(), publishedAt: z.string() }),
    }),
  ),
});

export class YouTubeError extends Error {
  readonly status: number;

  constructor(status: number, endpoint: string) {
    super(`YouTube ${endpoint} returned ${status}`);
    this.name = "YouTubeError";
    this.status = status;
  }

  /** The day's quota is spent; it resets at midnight Pacific. */
  get quotaExceeded(): boolean {
    return this.status === 403;
  }
}

export type FetchResponse = (url: string) => Promise<Response>;

export interface YouTubeOptions {
  apiKey: string;
  fetch?: FetchResponse;
}

export interface Page {
  videos: Video[];
  nextPageToken: string | null;
}

export class YouTube {
  /** Units spent by this client. */
  unitsSpent = 0;

  readonly #apiKey: string;
  readonly #fetch: FetchResponse;

  constructor({ apiKey, fetch: fetchResponse }: YouTubeOptions) {
    this.#apiKey = apiKey;
    this.#fetch =
      fetchResponse ??
      ((url) => fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }));
  }

  async #get(
    endpoint: keyof typeof QUOTA_UNITS,
    params: Record<string, string | undefined>,
  ): Promise<unknown> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) query.set(name, value);
    }
    query.set("key", this.#apiKey);
    this.unitsSpent += QUOTA_UNITS[endpoint];
    const response = await this.#fetch(`${API}/${endpoint}?${query}`);
    if (!response.ok) throw new YouTubeError(response.status, endpoint);
    return response.json();
  }

  /** Every playlist a channel has made. */
  async channelPlaylists(channelId: string): Promise<Playlist[]> {
    const playlists: Playlist[] = [];
    let token: string | undefined;
    do {
      const body = playlistsSchema.parse(
        await this.#get("playlists", {
          part: "snippet,contentDetails",
          maxResults: "50",
          channelId,
          pageToken: token,
        }),
      );
      for (const item of body.items) {
        playlists.push({
          id: item.id,
          title: decodeHtmlEntities(item.snippet.title),
          itemCount: item.contentDetails?.itemCount ?? 0,
        });
      }
      token = body.nextPageToken;
    } while (token);
    return playlists;
  }

  /**
   * One page of a playlist, newest first for an uploads playlist. Deleted
   * and private videos are skipped: they carry no publish time.
   */
  async playlistPage(playlistId: string, pageToken?: string): Promise<Page> {
    const body = playlistItemsSchema.parse(
      await this.#get("playlistItems", {
        part: "snippet,contentDetails",
        maxResults: "50",
        playlistId,
        pageToken,
      }),
    );
    const videos = body.items.flatMap((item): Video[] => {
      const youtubeId = item.contentDetails?.videoId;
      const publishedAt = item.contentDetails?.videoPublishedAt;
      const title = item.snippet?.title;
      return youtubeId && publishedAt && title
        ? [{ youtubeId, title: decodeHtmlEntities(title), publishedAt }]
        : [];
    });
    return { videos, nextPageToken: body.nextPageToken ?? null };
  }

  /** Every video in a playlist. */
  async playlistVideos(playlistId: string): Promise<Video[]> {
    const videos: Video[] = [];
    let token: string | undefined;
    do {
      const page = await this.playlistPage(playlistId, token);
      videos.push(...page.videos);
      token = page.nextPageToken ?? undefined;
    } while (token);
    return videos;
  }

  /**
   * A channel's uploads back to `since`, newest first, reading at most
   * `maxPages`. The uploads playlist holds only about the last 20,000 videos.
   */
  async uploadsSince(
    channelId: string,
    since: string,
    maxPages: number,
  ): Promise<{ videos: Video[]; complete: boolean }> {
    const videos: Video[] = [];
    let token: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const next = await this.playlistPage(uploadsPlaylistId(channelId), token);
      videos.push(...next.videos);
      const reachedBack = next.videos.some(
        (video) => video.publishedAt < since,
      );
      if (reachedBack || !next.nextPageToken) return { videos, complete: true };
      token = next.nextPageToken;
    }
    return { videos, complete: false };
  }

  /**
   * A channel's videos published within a window, matching `query`, newest
   * first, reading at most `maxPages` (100 units each).
   */
  async searchWindow(
    channelId: string,
    after: string,
    before: string,
    query: string,
    maxPages: number,
  ): Promise<Video[]> {
    const videos: Video[] = [];
    let token: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const body = searchSchema.parse(
        await this.#get("search", {
          part: "snippet",
          type: "video",
          order: "date",
          maxResults: "50",
          channelId,
          q: query,
          publishedAfter: after,
          publishedBefore: before,
          pageToken: token,
        }),
      );
      for (const item of body.items) {
        if (!item.id.videoId) continue;
        videos.push({
          youtubeId: item.id.videoId,
          title: decodeHtmlEntities(item.snippet.title),
          publishedAt: item.snippet.publishedAt,
        });
      }
      if (!body.nextPageToken) break;
      token = body.nextPageToken;
    }
    return videos;
  }

  /**
   * The videos still up among `ids`, with their current titles. An id
   * missing from the result was deleted or made private.
   */
  async videos(ids: readonly string[]): Promise<Map<string, Video>> {
    const found = new Map<string, Video>();
    for (let start = 0; start < ids.length; start += 50) {
      const body = videosSchema.parse(
        await this.#get("videos", {
          part: "snippet",
          maxResults: "50",
          id: ids.slice(start, start + 50).join(","),
        }),
      );
      for (const item of body.items) {
        found.set(item.id, {
          youtubeId: item.id,
          title: decodeHtmlEntities(item.snippet.title),
          publishedAt: item.snippet.publishedAt,
        });
      }
    }
    return found;
  }
}
