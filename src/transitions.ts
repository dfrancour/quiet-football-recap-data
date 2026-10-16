/**
 * What the live publisher changes, given what it knows: ESPN's view of the
 * games, the videos gathered, a person's corrections and the latest sweep of
 * linked videos. Each change is one game's new record (or its removal) and
 * the commit message that says why. Pure, so a pass is tested with a fake
 * clock and no network.
 *
 * In order: untrack what ESPN no longer calls final, track what it newly
 * does, apply corrections, act on the sweep (takedowns, retitles), match
 * recaps, and miss what the window closed on. Each step sees the steps
 * before it, so a game can be tracked and found in one pass, and a takedown
 * can be replaced by a better video at once.
 */

import type { Correction } from "./corrections.ts";
import {
  gameKey,
  gameName,
  instant,
  type DatasetGame,
  type SeasonFile,
} from "./dataset.ts";
import type { LiveGame } from "./espn.ts";
import {
  matchRecap,
  RECAP_WINDOW_MS,
  type Game,
  type Team,
  type Video,
} from "./matcher.ts";

export interface Change {
  season: number;
  key: string;
  /** The game's new record, or null to delete it. */
  next: DatasetGame | null;
  message: string;
}

export interface ReconcileInput {
  league: string;
  now: number;
  /** The season files the publisher is working in, by season. */
  files: ReadonlyMap<number, SeasonFile>;
  /** ESPN's latest view of the games around now. */
  schedule: readonly LiveGame[];
  /** ESPN ids of games the publisher watched go final, so it knows when. */
  watchedFinal: ReadonlySet<string>;
  videos: readonly Video[];
  corrections: readonly Correction[];
  /**
   * The latest sweep of linked videos, by YouTube id: the video as it is
   * now, or null if it was taken down. Ids not swept are absent.
   */
  sweep: ReadonlyMap<string, Video | null>;
  teams: readonly Team[];
}

export interface Reconciled {
  changes: Change[];
  files: Map<number, SeasonFile>;
}

export function reconcile(input: ReconcileInput): Reconciled {
  const { league, now, teams } = input;
  const at = instant(new Date(now).toISOString());
  const work = new Working(input.files);
  const changes: Change[] = [];
  const change = (
    game: DatasetGame,
    next: DatasetGame | null,
    verb: string,
    detail: string,
  ) => {
    work.set(game.season, gameKey(game), next);
    changes.push({
      season: game.season,
      key: gameKey(game),
      next,
      message: `${verb}(${gameName(league, game)}): ${detail}`,
    });
  };
  const inWindow = (game: { kickoff: string }) =>
    now < Date.parse(game.kickoff) + RECAP_WINDOW_MS;
  const correctionOf = (game: DatasetGame) =>
    input.corrections.find(
      (entry) =>
        entry.season === game.season &&
        entry.season_type === game.season_type &&
        entry.week === game.week &&
        entry.away === game.away &&
        entry.home === game.home,
    );
  const byId = new Map(input.videos.map((video) => [video.youtubeId, video]));
  const gone = new Set(
    [...input.sweep].filter(([, video]) => video === null).map(([id]) => id),
  );
  const candidates = input.videos.filter((video) => !gone.has(video.youtubeId));

  /** Back to searching inside the window; after it, what was watched says. */
  const withoutVideo = (game: DatasetGame): DatasetGame => {
    const base = baseOf(game);
    if (inWindow(game)) return { ...base, status: "searching" };
    const watched = game.status === "found" && game.detected_at !== undefined;
    return { ...base, status: watched ? "missing" : "unknown" };
  };

  // Untrack: ESPN called it final, then took it back.
  for (const live of input.schedule) {
    if (live.status === "final") continue;
    const game = work.get(live.season, keyOf(live));
    if (game?.status === "searching") {
      change(game, null, "untrack", "no longer final");
    }
  }

  // Track: newly final.
  for (const live of input.schedule) {
    if (live.status !== "final") continue;
    if (!work.has(live.season)) continue;
    if (work.get(live.season, keyOf(live))) continue;
    const base = {
      season: live.season,
      season_type: live.seasonType,
      week: live.week,
      away: live.away.abbreviation,
      home: live.home.abbreviation,
      external_ids: { espn: live.espnId },
      kickoff: instant(live.kickoff),
    };
    if (!inWindow(base)) {
      change(
        { ...base, status: "unknown" },
        { ...base, status: "unknown" },
        "track",
        "final after its window closed, unknown",
      );
      continue;
    }
    const next: DatasetGame = input.watchedFinal.has(live.espnId)
      ? { ...base, status: "searching", final_seen_at: at }
      : { ...base, status: "searching" };
    change(next, next, "track", "final, searching");
  }

  // Corrections: a person's decision wins.
  for (const game of work.all()) {
    const correction = correctionOf(game);
    if (!correction) continue;
    if (correction.youtube_id === null) {
      if (game.status === "found") {
        change(
          game,
          withoutVideo(game),
          "remove",
          `reason=${correction.reason}`,
        );
      }
      continue;
    }
    if (
      game.status === "found" &&
      game.video.youtube_id === correction.youtube_id
    ) {
      continue;
    }
    const video = byId.get(correction.youtube_id);
    if (!video) continue;
    const from = game.status === "found" ? game.video.youtube_id : game.status;
    change(
      game,
      { ...baseOf(game), status: "found", video: datasetVideo(video) },
      "correct",
      `${from} -> ${video.youtubeId}, reason=${correction.reason}`,
    );
  }

  // The sweep: takedowns and retitles of what is linked.
  for (const game of work.all()) {
    if (game.status !== "found" || !input.sweep.has(game.video.youtube_id)) {
      continue;
    }
    const swept = input.sweep.get(game.video.youtube_id);
    if (!swept) {
      change(game, withoutVideo(game), "remove", "reason=taken-down");
    } else if (swept.title !== game.video.title) {
      change(
        game,
        { ...game, video: { ...game.video, title: swept.title } },
        "retitle",
        `${JSON.stringify(game.video.title)} -> ${JSON.stringify(swept.title)}`,
      );
    }
  }

  // Matching: a recap for what is searching, or a better one for what the
  // publisher found itself while the window is open.
  for (const game of work.all()) {
    if (!inWindow(game) || correctionOf(game)) continue;
    const asGame = matcherGame(game, teams);
    if (!asGame) continue;
    if (game.status === "searching" || game.status === "unknown") {
      const video = matchRecap(candidates, asGame, teams);
      if (!video) continue;
      change(
        game,
        {
          ...baseOf(game),
          status: "found",
          video: datasetVideo(video),
          detected_at: at,
        },
        "add",
        `${video.youtubeId} ${JSON.stringify(video.title)}`,
      );
    } else if (game.status === "found" && game.detected_at) {
      const current = {
        youtubeId: game.video.youtube_id,
        title: game.video.title,
        publishedAt: game.video.published_at,
      };
      const video = matchRecap([current, ...candidates], asGame, teams);
      if (!video || video.youtubeId === current.youtubeId) continue;
      const reason = /game highlight/i.test(video.title)
        ? "game-highlights"
        : "better-match";
      change(
        game,
        { ...game, video: datasetVideo(video), detected_at: at },
        "correct",
        `${current.youtubeId} -> ${video.youtubeId}, reason=${reason}`,
      );
    }
  }

  // Miss: the window closed with nothing found.
  for (const game of work.all()) {
    if (game.status === "searching" && !inWindow(game)) {
      change(
        game,
        { ...baseOf(game), status: "missing" },
        "miss",
        "window closed",
      );
    }
  }

  return { changes, files: work.files() };
}

/** A season file with one game changed (or removed, for null). */
export function applyChange(file: SeasonFile, change: Change): SeasonFile {
  const games = file.games.filter((game) => gameKey(game) !== change.key);
  if (change.next) games.push(change.next);
  return { season: file.season, games };
}

function keyOf(live: LiveGame): string {
  return gameKey({
    season_type: live.seasonType,
    week: live.week,
    away: live.away.abbreviation,
    home: live.home.abbreviation,
  });
}

/** A record's identity and kickoff, with what the publisher saw it do. */
function baseOf(game: DatasetGame) {
  const base = {
    season: game.season,
    season_type: game.season_type,
    week: game.week,
    away: game.away,
    home: game.home,
    external_ids: game.external_ids,
    kickoff: game.kickoff,
  };
  return game.final_seen_at
    ? { ...base, final_seen_at: game.final_seen_at }
    : base;
}

function datasetVideo(video: Video) {
  return {
    youtube_id: video.youtubeId,
    title: video.title,
    published_at: instant(video.publishedAt),
  };
}

function matcherGame(game: DatasetGame, teams: readonly Team[]): Game | null {
  const team = (abbreviation: string) =>
    teams.find((entry) => entry.abbreviation === abbreviation);
  const home = team(game.home);
  const away = team(game.away);
  return home && away
    ? { week: game.week, kickoff: game.kickoff, home, away }
    : null;
}

/** The season files being changed, game by game. */
class Working {
  readonly #seasons = new Map<number, Map<string, DatasetGame>>();

  constructor(files: ReadonlyMap<number, SeasonFile>) {
    for (const [season, file] of files) {
      this.#seasons.set(
        season,
        new Map(file.games.map((game) => [gameKey(game), game])),
      );
    }
  }

  has(season: number): boolean {
    return this.#seasons.has(season);
  }

  get(season: number, key: string): DatasetGame | undefined {
    return this.#seasons.get(season)?.get(key);
  }

  set(season: number, key: string, game: DatasetGame | null): void {
    const games = this.#seasons.get(season);
    if (!games) throw new Error(`No file for season ${season}`);
    if (game) games.set(key, game);
    else games.delete(key);
  }

  /** Every game, as it stands now. */
  all(): DatasetGame[] {
    return [...this.#seasons.values()].flatMap((games) => [...games.values()]);
  }

  files(): Map<number, SeasonFile> {
    return new Map(
      [...this.#seasons].map(([season, games]) => [
        season,
        { season, games: [...games.values()] },
      ]),
    );
  }
}
