/**
 * Reads a season's schedule from ESPN's scoreboard: every game of the
 * preseason, regular season and postseason, with its kickoff, status and
 * teams, numbered the way the dataset numbers weeks.
 */

import { z } from "zod";
import type { Game, Team } from "./matcher.ts";

export type SeasonType = "preseason" | "regular" | "postseason";

export type GameStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "canceled";

export interface ScheduledGame extends Game {
  seasonType: SeasonType;
  status: GameStatus;
  /** ESPN's event id, kept as a reference in `external_ids`. */
  espnId: string;
}

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

const ESPN_SEASON_TYPES: Readonly<Record<SeasonType, number>> = {
  preseason: 1,
  regular: 2,
  postseason: 3,
};

/** The Hall of Fame game, then three or four weeks; ESPN has no week past 5. */
const PRESEASON_WEEKS = 5;

/**
 * ESPN's postseason weeks: Wild Card, Divisional and Conference as 1–3, then
 * the Pro Bowl and the Super Bowl in 4 and 5 (the Super Bowl was 4 before
 * 2015, and the Pro Bowl has moved around it).
 */
const POSTSEASON_WEEKS = 5;

/** Regular-season weeks: 17 through 2020, 18 since. */
export function regularSeasonWeeks(season: number): number {
  return season >= 2021 ? 18 : 17;
}

export function scoreboardUrl(
  season: number,
  seasonType: SeasonType,
  week: number,
): string {
  return `${SCOREBOARD}?dates=${season}&seasontype=${ESPN_SEASON_TYPES[seasonType]}&week=${week}`;
}

const scoreboardSchema = z.object({
  events: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      date: z.string(),
      season: z.object({ year: z.number(), type: z.number() }).optional(),
      week: z.object({ number: z.number() }).optional(),
      competitions: z
        .array(
          z.object({
            competitors: z.array(
              z.object({
                homeAway: z.string(),
                team: z.object({ id: z.union([z.string(), z.number()]) }),
              }),
            ),
            status: z
              .object({
                type: z
                  .object({
                    name: z.string().optional(),
                    state: z.string().optional(),
                  })
                  .optional(),
              })
              .optional(),
            notes: z
              .array(z.object({ headline: z.string().optional() }))
              .optional(),
          }),
        )
        .min(1),
    }),
  ),
});

type Status = NonNullable<
  z.infer<
    typeof scoreboardSchema
  >["events"][number]["competitions"][number]["status"]
>["type"];

function readStatus(type: Status): GameStatus {
  switch (type?.name) {
    case "STATUS_FINAL":
      return "final";
    case "STATUS_IN_PROGRESS":
    case "STATUS_HALFTIME":
    case "STATUS_END_PERIOD":
      return "in_progress";
    case "STATUS_POSTPONED":
      return "postponed";
    case "STATUS_CANCELED":
      return "canceled";
  }
  if (type?.state === "post") return "final";
  if (type?.state === "in") return "in_progress";
  return "scheduled";
}

/**
 * The dataset's week for a game. The preseason and regular season keep the
 * week asked for. The postseason continues the regular season's count: ESPN's
 * weeks 1–3 are the first three rounds, and the Super Bowl is found by its
 * headline, since the Pro Bowl shares its weeks. Null drops the game (the Pro
 * Bowl).
 */
function datasetWeek(
  season: number,
  seasonType: SeasonType,
  week: number,
  headline: string | undefined,
): number | null {
  if (seasonType !== "postseason") return week;
  const totalWeeks = regularSeasonWeeks(season);
  if (week >= 1 && week <= 3) return totalWeeks + week;
  return headline && /super bowl/i.test(headline) ? totalWeeks + 4 : null;
}

/**
 * The games on one of ESPN's scoreboards. A game whose teams are not both
 * known is dropped: a playoff round ESPN has not set lists "TBD" teams, and
 * the Pro Bowl's are conferences. Throws on a payload it cannot read.
 */
export function gamesFromScoreboard(
  payload: unknown,
  season: number,
  seasonType: SeasonType,
  week: number,
  teams: readonly Team[],
): ScheduledGame[] {
  const parsed = scoreboardSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `ESPN's ${season} ${seasonType} week ${week} is unreadable`,
    );
  }
  const byEspnId = new Map(teams.map((team) => [team.espnId, team]));

  return parsed.data.events.flatMap((event): ScheduledGame[] => {
    const competition = event.competitions[0]!;
    const side = (homeAway: string) =>
      byEspnId.get(
        String(
          competition.competitors.find((entry) => entry.homeAway === homeAway)
            ?.team.id,
        ),
      );
    const home = side("home");
    const away = side("away");
    const gameWeek = datasetWeek(
      season,
      seasonType,
      week,
      competition.notes?.[0]?.headline,
    );
    if (!home || !away || gameWeek === null) return [];
    return [
      {
        seasonType,
        week: gameWeek,
        kickoff: event.date,
        status: readStatus(competition.status?.type),
        home,
        away,
        espnId: String(event.id),
      },
    ];
  });
}

export type FetchJson = (url: string) => Promise<unknown>;

const RETRY_AFTER_MS = 2_000;
const PAUSE_MS = 250;
const TIMEOUT_MS = 15_000;

/** ESPN, once more after a pause if it fails. */
export async function fetchEspnJson(url: string): Promise<unknown> {
  const attempt = async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`ESPN ${response.status} for ${url}`);
    return response.json();
  };
  try {
    return await attempt();
  } catch {
    await new Promise((done) => setTimeout(done, RETRY_AFTER_MS));
    return attempt();
  }
}

export interface ScheduleOptions {
  teams: readonly Team[];
  fetchJson?: FetchJson;
  pauseMs?: number;
}

/**
 * Every game of a season, preseason to Super Bowl. A regular-season week
 * always has games, so an empty one fails the whole read rather than drop
 * that week's games; a preseason or postseason week can be empty.
 */
export async function fetchSeasonSchedule(
  season: number,
  { teams, fetchJson = fetchEspnJson, pauseMs = PAUSE_MS }: ScheduleOptions,
): Promise<ScheduledGame[]> {
  const weeks: [SeasonType, number][] = [
    ...range(PRESEASON_WEEKS).map((week): [SeasonType, number] => [
      "preseason",
      week,
    ]),
    ...range(regularSeasonWeeks(season)).map((week): [SeasonType, number] => [
      "regular",
      week,
    ]),
    ...range(POSTSEASON_WEEKS).map((week): [SeasonType, number] => [
      "postseason",
      week,
    ]),
  ];

  const games: ScheduledGame[] = [];
  for (const [index, [seasonType, week]] of weeks.entries()) {
    if (index > 0) await new Promise((done) => setTimeout(done, pauseMs));
    const payload = await fetchJson(scoreboardUrl(season, seasonType, week));
    const weekGames = gamesFromScoreboard(
      payload,
      season,
      seasonType,
      week,
      teams,
    );
    if (seasonType === "regular" && weekGames.length === 0) {
      throw new Error(`ESPN returned no games for ${season} week ${week}`);
    }
    games.push(...weekGames);
  }
  return games;
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

/** A game read from a day's scoreboard, which can span seasons. */
export interface LiveGame extends ScheduledGame {
  season: number;
}

const SEASON_TYPES_BY_NUMBER: Readonly<Record<number, SeasonType>> = {
  1: "preseason",
  2: "regular",
  3: "postseason",
};

/** ESPN's scoreboard for the current week, upcoming games included. */
export const CURRENT_SCOREBOARD_URL = SCOREBOARD;

/** ESPN's scoreboard for one day, which ESPN counts in US Eastern time. */
export function scoreboardDayUrl(day: string): string {
  return `${SCOREBOARD}?dates=${day}`;
}

/** An instant's day in US Eastern time, as ESPN's `dates` takes it: `20261015`. */
export function easternDay(at: number | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}${part("month")}${part("day")}`;
}

/**
 * The games on a day's scoreboard (or the current week's, with no date).
 * Unlike a week's, each event says its own season, season type and week,
 * numbered as the dataset numbers them. An event without them, or whose
 * teams are not both known (the Pro Bowl, a playoff round not yet set), is
 * dropped. Throws on a payload it cannot read.
 */
export function gamesFromDay(
  payload: unknown,
  teams: readonly Team[],
): LiveGame[] {
  const parsed = scoreboardSchema.safeParse(payload);
  if (!parsed.success) throw new Error("ESPN's scoreboard is unreadable");
  const byEspnId = new Map(teams.map((team) => [team.espnId, team]));

  return parsed.data.events.flatMap((event): LiveGame[] => {
    const seasonType = SEASON_TYPES_BY_NUMBER[event.season?.type ?? 0];
    const season = event.season?.year;
    const espnWeek = event.week?.number;
    if (!seasonType || !season || !espnWeek) return [];
    const competition = event.competitions[0]!;
    const side = (homeAway: string) =>
      byEspnId.get(
        String(
          competition.competitors.find((entry) => entry.homeAway === homeAway)
            ?.team.id,
        ),
      );
    const home = side("home");
    const away = side("away");
    const week = datasetWeek(
      season,
      seasonType,
      espnWeek,
      competition.notes?.[0]?.headline,
    );
    if (!home || !away || week === null) return [];
    return [
      {
        season,
        seasonType,
        week,
        kickoff: event.date,
        status: readStatus(competition.status?.type),
        home,
        away,
        espnId: String(event.id),
      },
    ];
  });
}
