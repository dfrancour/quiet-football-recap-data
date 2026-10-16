/**
 * When the publisher reads ESPN and YouTube, worked out from the data rather
 * than run on fixed intervals (docs/scheduling.md). `plan` is pure: given
 * what is known and the time, it says which reads are due and when to wake
 * next, so it is tested with a fake clock.
 */

import { gameKey, type DatasetGame } from "./dataset.ts";
import type { GameStatus } from "./espn.ts";
import { RECAP_WINDOW_MS } from "./matcher.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** ESPN while a game is in play: free, and finals must be seen at once. */
export const LIVE_SCOREBOARD_MS = MINUTE;
/** ESPN otherwise: flexed games, a new season, games missed while down. */
export const CATCH_UP_MS = DAY;
/** A game still not final this long after kickoff is left to the catch-up. */
const IN_PLAY_MAX_MS = 12 * HOUR;
/** When a game went final, if the publisher did not see it: a typical game's length. */
const ASSUMED_LENGTH_MS = 3.5 * HOUR;
/** One search of a game's window, this long after final, if nothing is found. */
export const SEARCH_AFTER_MS = 12 * HOUR;
export const MAX_SEARCHES_PER_DAY = 20;
const SEARCH_UNITS = 100;
/** Linked videos are checked for takedowns and retitles this often. */
export const SWEEP_MS = 7 * DAY;
/** YouTube's daily quota, which resets at midnight Pacific. */
export const DAILY_UNITS = 10_000;
/** Never sleep longer, so a schedule change is never missed for long. */
export const MAX_SLEEP_MS = HOUR;
/** Never wake sooner, so a read that keeps failing cannot spin. */
const MIN_SLEEP_MS = 30 * SECOND;
/** A timer can fire a little early; a read due within this is due. */
const SLACK_MS = 2 * SECOND;

/** How often a searching game wants the uploads read, by time since final. */
const UPLOAD_CADENCE: readonly [upTo: number, every: number][] = [
  [2 * HOUR, MINUTE],
  [6 * HOUR, 5 * MINUTE],
  [24 * HOUR, 30 * MINUTE],
  [Infinity, 3 * HOUR],
];

export interface PlannerState {
  /** ESPN's latest view of the games around now. */
  schedule: readonly { kickoff: string; status: GameStatus }[];
  /** Every record in the seasons being published. */
  games: readonly DatasetGame[];
  /** `searchKey`s of the games whose window has been searched. */
  searched: ReadonlySet<string>;
  lastScoreboardAt?: number;
  lastCatchUpAt?: number;
  lastUploadsAt?: number;
  lastSweepAt?: number;
  /** Today's (Pacific) YouTube spending. */
  quota: { units: number; searches: number; exhausted: boolean };
  /** When the quota resets: the next midnight Pacific. */
  quotaResetAt: number;
}

export interface Plan {
  /**
   * `catch-up` reads the current week and the last few days; `live` reads
   * only the days of games in play.
   */
  scoreboard: "catch-up" | "live" | null;
  uploads: boolean;
  /** Games whose window to search now. */
  searches: DatasetGame[];
  sweep: boolean;
  wakeAt: number;
}

/** How a game's search is remembered: `2026 regular 6 SEA@DEN`. */
export function searchKey(game: DatasetGame): string {
  return `${game.season} ${gameKey(game)}`;
}

/** When a game went final: when it was seen to, or a typical game after kickoff. */
export function finalAt(game: DatasetGame): number {
  return game.final_seen_at
    ? Date.parse(game.final_seen_at)
    : Date.parse(game.kickoff) + ASSUMED_LENGTH_MS;
}

/**
 * A cadence as the day's quota tightens: the long tail stretches first, and
 * the first two hours after a final, when recaps land, hold until the last
 * tenth of the budget.
 */
export function stretched(every: number, unitsUsed: number): number {
  const used = unitsUsed / DAILY_UNITS;
  if (used >= 0.9) return Math.max(every * 4, 30 * MINUTE);
  if (every <= MINUTE) return every;
  if (used >= 0.75) return every * 4;
  if (used >= 0.5) return every * 2;
  return every;
}

export function uploadCadence(sinceFinal: number, unitsUsed: number): number {
  const every = UPLOAD_CADENCE.find(([upTo]) => sinceFinal < upTo)![1];
  return stretched(every, unitsUsed);
}

export function plan(state: PlannerState, now: number): Plan {
  const wakes: number[] = [now + MAX_SLEEP_MS];
  const due = (last: number | undefined, every: number) => {
    if (last === undefined || now - last >= every - SLACK_MS) return true;
    wakes.push(last + every);
    return false;
  };

  // ESPN.
  const inPlay = state.schedule.some((game) => {
    const kickoff = Date.parse(game.kickoff);
    return (
      (game.status === "scheduled" || game.status === "in_progress") &&
      kickoff <= now &&
      now - kickoff < IN_PLAY_MAX_MS
    );
  });
  const catchUp = due(state.lastCatchUpAt, CATCH_UP_MS);
  const live = inPlay && due(state.lastScoreboardAt, LIVE_SCOREBOARD_MS);
  for (const game of state.schedule) {
    const kickoff = Date.parse(game.kickoff);
    if (kickoff > now && game.status === "scheduled") wakes.push(kickoff);
  }

  // YouTube.
  const searching = state.games.filter((game) => game.status === "searching");
  const { quota } = state;
  let uploads = false;
  const searches: DatasetGame[] = [];
  let sweep = false;
  if (quota.exhausted) {
    if (searching.length > 0 || state.games.length > 0) {
      wakes.push(state.quotaResetAt);
    }
  } else {
    if (searching.length > 0) {
      const every = Math.min(
        ...searching.map((game) =>
          uploadCadence(now - finalAt(game), quota.units),
        ),
      );
      uploads = due(state.lastUploadsAt, every);
    }

    let units = quota.units;
    let count = quota.searches;
    for (const game of searching) {
      if (state.searched.has(searchKey(game))) continue;
      const at = finalAt(game) + SEARCH_AFTER_MS;
      if (now < at) {
        wakes.push(at);
        continue;
      }
      const affordable =
        count < MAX_SEARCHES_PER_DAY &&
        units + SEARCH_UNITS <= DAILY_UNITS * 0.9;
      if (affordable) {
        searches.push(game);
        count += 1;
        units += SEARCH_UNITS;
      } else {
        wakes.push(state.quotaResetAt);
      }
    }

    if (state.games.some((game) => game.status === "found")) {
      sweep = due(state.lastSweepAt, SWEEP_MS);
    }
  }

  // The window closing on a searching game is a change with no read.
  for (const game of searching) {
    wakes.push(Date.parse(game.kickoff) + RECAP_WINDOW_MS);
  }

  const wakeAt = Math.max(now + MIN_SLEEP_MS, Math.min(...wakes));
  return {
    scoreboard: catchUp ? "catch-up" : live ? "live" : null,
    uploads,
    searches,
    sweep,
    wakeAt,
  };
}

/** The day in Pacific time, when YouTube's quota resets: `2026-10-15`. */
export function pacificDay(at: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

/** The next midnight Pacific after `at`. */
export function nextPacificMidnight(at: number): number {
  const today = pacificDay(at);
  // The day changes within 25 hours; find the first minute it has.
  let low = at;
  let high = at + 25 * HOUR;
  while (high - low > MINUTE) {
    const mid = Math.floor((low + high) / 2);
    if (pacificDay(mid) === today) low = mid;
    else high = mid;
  }
  return Math.floor(high / MINUTE) * MINUTE;
}
