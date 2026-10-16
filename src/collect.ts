/**
 * Gathers a channel's videos into the cache: its uploads, its playlists,
 * searches of the windows where games still have no recap, and specific
 * videos by id.
 */

import type { VideoCache } from "./cache.ts";
import type { Team } from "./matcher.ts";
import { uploadsPlaylistId, type YouTube } from "./youtube.ts";

const HOUR = 3_600_000;

export interface CollectResult {
  added: number;
  /** Set when the run stopped early: the quota ran out, or the cap was hit. */
  stopped?: string;
}

export async function collectUploads(
  youtube: YouTube,
  cache: VideoCache,
  channelId: string,
  since: string,
  maxPages: number,
): Promise<CollectResult> {
  const { videos, complete } = await youtube.uploadsSince(
    channelId,
    since,
    maxPages,
  );
  const added = cache.add(videos);
  return complete ? { added } : { added, stopped: `read ${maxPages} pages` };
}

/**
 * The newest uploads, page by page, until one already gathered or one older
 * than `since`: on a quiet poll that is one page, one unit. Reads at most
 * `maxPages`, for a cache that is empty or far behind.
 */
export async function collectNewUploads(
  youtube: YouTube,
  cache: VideoCache,
  channelId: string,
  since: string,
  maxPages: number,
): Promise<CollectResult & { pages: number }> {
  const playlist = uploadsPlaylistId(channelId);
  let added = 0;
  let token: string | undefined;
  for (let pages = 1; pages <= maxPages; pages += 1) {
    const page = await youtube.playlistPage(playlist, token);
    const reachedKnown = page.videos.some(
      (video) => cache.has(video.youtubeId) || video.publishedAt < since,
    );
    added += cache.add(page.videos);
    if (reachedKnown || !page.nextPageToken) return { added, pages };
    token = page.nextPageToken;
  }
  return { added, pages: maxPages, stopped: `read ${maxPages} pages` };
}

/** Every playlist whose title matches `include` and not `exclude`. */
export async function collectPlaylists(
  youtube: YouTube,
  cache: VideoCache,
  channelId: string,
  include: RegExp,
  exclude: RegExp | null,
): Promise<CollectResult & { playlists: number }> {
  const playlists = (await youtube.channelPlaylists(channelId)).filter(
    (playlist) =>
      include.test(playlist.title) &&
      !(exclude && exclude.test(playlist.title)),
  );
  let added = 0;
  for (const playlist of playlists) {
    added += cache.add(await youtube.playlistVideos(playlist.id));
  }
  return { added, playlists: playlists.length };
}

export interface GapGame {
  season: number;
  season_type: string;
  week: number;
  away: string;
  home: string;
  kickoff: string;
}

export interface SearchWindow {
  after: string;
  before: string;
  query: string;
  games: readonly GapGame[];
}

/** How a search is remembered, so it is never paid for twice. */
export function searchKey(window: SearchWindow): string {
  return `${window.query}|${window.after}|${window.before}`;
}

/**
 * The windows to search for games still without a recap: each game's
 * kickoff to `hours` after it. Overlapping windows (a Sunday's games) are
 * searched once for "vs"; `perGame` gives each game its own search for both
 * teams' nicknames, for a window too busy for one search to reach it.
 */
export function gapWindows(
  games: readonly GapGame[],
  teams: readonly Team[],
  { hours, perGame }: { hours: number; perGame: boolean },
): SearchWindow[] {
  const sorted = [...games].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const span = (game: GapGame) => {
    const start = Date.parse(game.kickoff);
    return { start, end: start + hours * HOUR };
  };
  const iso = (ms: number) => new Date(ms).toISOString();

  if (perGame) {
    const nickname = (abbreviation: string) =>
      teams.find((team) => team.abbreviation === abbreviation)?.nickname ??
      abbreviation;
    return sorted.map((game) => {
      const { start, end } = span(game);
      return {
        after: iso(start),
        before: iso(end),
        query: `${nickname(game.away)} ${nickname(game.home)}`,
        games: [game],
      };
    });
  }

  const clusters: { start: number; end: number; games: GapGame[] }[] = [];
  for (const game of sorted) {
    const { start, end } = span(game);
    const last = clusters.at(-1);
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
      last.games.push(game);
    } else {
      clusters.push({ start, end, games: [game] });
    }
  }
  return clusters.map((cluster) => ({
    after: iso(cluster.start),
    before: iso(cluster.end),
    query: "vs",
    games: cluster.games,
  }));
}

/**
 * Searches each window not searched before, up to `maxSearches` pages
 * (100 units each), reading up to `pagesPerWindow` per window.
 */
export async function collectGaps(
  youtube: YouTube,
  cache: VideoCache,
  channelId: string,
  windows: readonly SearchWindow[],
  {
    maxSearches,
    pagesPerWindow,
  }: { maxSearches: number; pagesPerWindow: number },
): Promise<CollectResult & { windows: number; skipped: number }> {
  let added = 0;
  let searched = 0;
  let skipped = 0;
  const searchesBefore = youtube.unitsSpent;
  for (const window of windows) {
    if (cache.searched(searchKey(window))) {
      skipped += 1;
      continue;
    }
    const spent = (youtube.unitsSpent - searchesBefore) / 100;
    if (spent + pagesPerWindow > maxSearches) {
      return {
        added,
        windows: searched,
        skipped,
        stopped: `${maxSearches} searches`,
      };
    }
    const videos = await youtube.searchWindow(
      channelId,
      window.after,
      window.before,
      window.query,
      pagesPerWindow,
    );
    added += cache.add(videos);
    cache.markSearched(searchKey(window));
    searched += 1;
  }
  return { added, windows: searched, skipped };
}

/** Specific videos, such as one a correction names. */
export async function collectIds(
  youtube: YouTube,
  cache: VideoCache,
  ids: readonly string[],
): Promise<CollectResult & { missing: string[] }> {
  const found = await youtube.videos(ids);
  const added = cache.add([...found.values()]);
  return { added, missing: ids.filter((id) => !found.has(id)) };
}
