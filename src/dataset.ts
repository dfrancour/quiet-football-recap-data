/**
 * The season file: its records, how a game is named, and the one canonical
 * way it is written, so that writing it again without news changes no byte.
 */

import { z } from "zod";
import type { SeasonType } from "./espn.ts";

export interface DatasetVideo {
  youtube_id: string;
  title: string;
  published_at: string;
}

interface Base {
  season: number;
  season_type: SeasonType;
  week: number;
  away: string;
  home: string;
  external_ids: Readonly<Record<string, string>>;
  kickoff: string;
  final_seen_at?: string;
}

export type DatasetGame =
  | (Base & { status: "searching" })
  | (Base & { status: "found"; video: DatasetVideo; detected_at?: string })
  | (Base & { status: "missing" })
  | (Base & { status: "unknown" });

export interface SeasonFile {
  season: number;
  games: DatasetGame[];
}

/** An instant to the second, in UTC: `2026-10-13T04:10:35Z`. */
export function instant(value: string): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** How commit messages name a game: `nfl 2026 W6 KC@BUF`, `nfl 2026 PRE W3 CHI@TEN`. */
export function gameName(league: string, game: DatasetGame): string {
  const type = game.season_type === "preseason" ? "PRE " : "";
  return `${league} ${game.season} ${type}W${game.week} ${game.away}@${game.home}`;
}

const SEASON_TYPES: readonly SeasonType[] = [
  "preseason",
  "regular",
  "postseason",
];

/** Season type, then week, kickoff and home team. */
export function compareGames(a: DatasetGame, b: DatasetGame): number {
  return (
    SEASON_TYPES.indexOf(a.season_type) - SEASON_TYPES.indexOf(b.season_type) ||
    a.week - b.week ||
    a.kickoff.localeCompare(b.kickoff) ||
    a.home.localeCompare(b.home)
  );
}

/** A game's keys in schema order, leaving out the ones it does not have. */
function canonicalGame(game: DatasetGame): Record<string, unknown> {
  const ids = Object.fromEntries(
    Object.entries(game.external_ids).sort(([a], [b]) => a.localeCompare(b)),
  );
  const out: Record<string, unknown> = {
    season: game.season,
    season_type: game.season_type,
    week: game.week,
    away: game.away,
    home: game.home,
    external_ids: ids,
    kickoff: game.kickoff,
    status: game.status,
  };
  if (game.final_seen_at) out.final_seen_at = game.final_seen_at;
  if (game.status === "found") {
    out.video = {
      youtube_id: game.video.youtube_id,
      title: game.video.title,
      published_at: game.video.published_at,
    };
    if (game.detected_at) out.detected_at = game.detected_at;
  }
  return out;
}

/** The file as the publisher writes it: sorted, keys in order, 2-space JSON. */
export function serializeSeasonFile(file: SeasonFile): string {
  const body = {
    $schema: "./schema.json",
    schema_version: 1,
    season: file.season,
    games: [...file.games].sort(compareGames).map(canonicalGame),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

const baseSchema = {
  season: z.number().int(),
  season_type: z.enum(["preseason", "regular", "postseason"]),
  week: z.number().int(),
  away: z.string(),
  home: z.string(),
  external_ids: z.record(z.string(), z.string()),
  kickoff: instantSchema,
  final_seen_at: instantSchema.optional(),
};

const gameSchema = z.discriminatedUnion("status", [
  z.object({ ...baseSchema, status: z.literal("searching") }),
  z.object({
    ...baseSchema,
    status: z.literal("found"),
    video: z.object({
      youtube_id: z.string(),
      title: z.string(),
      published_at: instantSchema,
    }),
    detected_at: instantSchema.optional(),
  }),
  z.object({ ...baseSchema, status: z.literal("missing") }),
  z.object({ ...baseSchema, status: z.literal("unknown") }),
]);

const seasonFileSchema = z.object({
  season: z.number().int(),
  games: z.array(gameSchema),
});

/** A season file as written; the schema's full checks are `npm run check`'s. */
export function parseSeasonFile(text: string): SeasonFile {
  return seasonFileSchema.parse(JSON.parse(text));
}

/** What names a game within its season, as a map key: `regular 6 SEA@DEN`. */
export function gameKey(game: {
  season_type: string;
  week: number;
  away: string;
  home: string;
}): string {
  return `${game.season_type} ${game.week} ${game.away}@${game.home}`;
}
