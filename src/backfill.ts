/**
 * A season built after the fact, from its schedule and the videos gathered
 * for it. Nothing in it was watched live, so no record has `final_seen_at`
 * or `detected_at`, and a game without a recap is `unknown`, never
 * `missing`.
 */

import { correctionFor, type Correction } from "./corrections.ts";
import { instant, type DatasetGame, type SeasonFile } from "./dataset.ts";
import type { ScheduledGame } from "./espn.ts";
import { matchRecap, type Team, type Video } from "./matcher.ts";

export function backfillSeason(
  season: number,
  schedule: readonly ScheduledGame[],
  videos: readonly Video[],
  corrections: readonly Correction[],
  teams: readonly Team[],
): SeasonFile {
  const byId = new Map(videos.map((video) => [video.youtubeId, video]));

  const games = schedule
    .filter((game) => game.status === "final")
    .map((game): DatasetGame => {
      const base = {
        season,
        season_type: game.seasonType,
        week: game.week,
        away: game.away.abbreviation,
        home: game.home.abbreviation,
        external_ids: { espn: game.espnId },
        kickoff: instant(game.kickoff),
      };
      const video = pickVideo(season, game, videos, byId, corrections, teams);
      return video
        ? {
            ...base,
            status: "found",
            video: {
              youtube_id: video.youtubeId,
              title: video.title,
              published_at: instant(video.publishedAt),
            },
          }
        : { ...base, status: "unknown" };
    });

  return { season, games };
}

function pickVideo(
  season: number,
  game: ScheduledGame,
  videos: readonly Video[],
  byId: ReadonlyMap<string, Video>,
  corrections: readonly Correction[],
  teams: readonly Team[],
): Video | null {
  const correction = correctionFor(corrections, season, game);
  if (!correction) return matchRecap(videos, game, teams);
  if (correction.youtube_id === null) return null;
  const video = byId.get(correction.youtube_id);
  if (!video) {
    throw new Error(
      `Correction for ${season} W${game.week} ${game.away.abbreviation}@${game.home.abbreviation} names ${correction.youtube_id}, which is not among the videos`,
    );
  }
  return video;
}

interface GameRef {
  season_type: string;
  week: number;
  away: string;
  home: string;
  status: string;
}

/**
 * The games a rewrite would take a recap away from: `found` in the file on
 * disk, not found now. Almost always a cache missing videos it once had (a
 * fresh checkout, uploads gathered since too late a date), not news, so the
 * CLI refuses to write unless told to.
 */
export function lostRecaps(
  before: { games: readonly GameRef[] } | null,
  after: { games: readonly GameRef[] },
): string[] {
  if (!before) return [];
  const name = (game: GameRef) =>
    `${game.season_type === "preseason" ? "PRE " : ""}W${game.week} ${game.away}@${game.home}`;
  const foundNow = new Set(
    after.games.filter((game) => game.status === "found").map(name),
  );
  return before.games
    .filter((game) => game.status === "found" && !foundNow.has(name(game)))
    .map(name);
}
