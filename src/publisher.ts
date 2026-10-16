/**
 * The live publisher: one pass, and the loop that runs passes. A pass pulls,
 * asks the planner what is due, reads ESPN and YouTube accordingly, turns
 * what it learned into changes, commits each, and pushes once. All state is
 * on disk (the season files, and `.cache/`), so a restart is just another
 * pass, and a pass with no news changes nothing.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { VideoCache } from "./cache.ts";
import { collectNewUploads } from "./collect.ts";
import { correctionsSchema, type Correction } from "./corrections.ts";
import {
  parseSeasonFile,
  serializeSeasonFile,
  type SeasonFile,
} from "./dataset.ts";
import {
  CURRENT_SCOREBOARD_URL,
  easternDay,
  gamesFromDay,
  scoreboardDayUrl,
  type FetchJson,
  type LiveGame,
} from "./espn.ts";
import type { Git } from "./git.ts";
import { RECAP_WINDOW_MS, type Team, type Video } from "./matcher.ts";
import {
  finalAt,
  nextPacificMidnight,
  pacificDay,
  plan,
  searchKey,
  type PlannerState,
} from "./planner.ts";
import { applyChange, reconcile } from "./transitions.ts";
import { YouTubeError, type YouTube } from "./youtube.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A final counts as watched if the game was seen not final this recently. */
const WATCHED_WITHIN_MS = 10 * MINUTE;
/** Games ESPN is remembered for, around now. */
const SCHEDULE_PAST_MS = 4 * DAY;
const SCHEDULE_AHEAD_MS = 10 * DAY;
/** Days back the catch-up reads: every game whose window may be open. */
const CATCH_UP_DAYS = 4;
const UPLOAD_PAGES = 10;
const SEARCH_PAGES = 2;
/** After an error, try again this soon. */
const RETRY_MS = 5 * MINUTE;

export interface PublisherOptions {
  /** The checkout the publisher writes: its league's folder and `.cache/`. */
  dataDir: string;
  league: string;
  teams: readonly Team[];
  channelId: string;
  fetchJson: FetchJson;
  /** A fresh client per pass, so each pass's units are counted. */
  youtube: () => YouTube;
  git: Git;
  /** Pushing can be turned off to try the publisher on a working copy. */
  push: boolean;
  /** The commit of the publisher's own code, for each commit's trailer. */
  build: string;
  log: (line: string) => void;
}

export interface PassReport {
  at: string;
  commits: string[];
  pushed: boolean | null;
  unpushed: number;
  wakeAt: number;
  unitsToday: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// State on disk

const scheduleEntrySchema = z.object({
  season: z.number(),
  seasonType: z.enum(["preseason", "regular", "postseason"]),
  week: z.number(),
  away: z.string(),
  home: z.string(),
  espnId: z.string(),
  kickoff: z.string(),
  status: z.enum([
    "scheduled",
    "in_progress",
    "final",
    "postponed",
    "canceled",
  ]),
  /** When the publisher last read this status. */
  seenAt: z.number(),
});
type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

const stateSchema = z.object({
  schedule: z.array(scheduleEntrySchema).default([]),
  lastScoreboardAt: z.number().optional(),
  lastCatchUpAt: z.number().optional(),
  lastUploadsAt: z.number().optional(),
  lastSweepAt: z.number().optional(),
  quota: z
    .object({
      day: z.string(),
      units: z.number(),
      searches: z.number(),
      exhausted: z.boolean(),
    })
    .default({ day: "", units: 0, searches: 0, exhausted: false }),
});
export type PublisherState = z.infer<typeof stateSchema>;

export function paths(dataDir: string, league: string) {
  const cache = join(dataDir, ".cache");
  return {
    league: join(dataDir, league),
    season: (season: number) => join(dataDir, league, `${season}.json`),
    corrections: join(dataDir, league, "corrections.json"),
    videos: join(cache, `${league}-videos.json`),
    state: join(cache, "publisher-state.json"),
    status: join(cache, "publisher-status.json"),
    lock: join(cache, "publisher.lock"),
  };
}

function readState(path: string): PublisherState {
  if (!existsSync(path)) return stateSchema.parse({});
  return stateSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// One pass

export async function runPass(
  options: PublisherOptions,
  now: number,
): Promise<PassReport> {
  const { league, teams, git, log } = options;
  const where = paths(options.dataDir, league);
  const errors: string[] = [];
  const fail = (what: string, error: unknown) => {
    const line = `${what}: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(line);
    log(line);
  };

  if ((await git.pull()) === "offline") {
    fail("pull", "the remote could not be reached; working from the last pull");
  }
  if (await git.dirty([`${league}/`])) {
    throw new Error(
      `${where.league} has changes not committed; the publisher will not write over them`,
    );
  }

  const state = readState(where.state);
  const today = pacificDay(now);
  if (state.quota.day !== today) {
    state.quota = { day: today, units: 0, searches: 0, exhausted: false };
  }
  const cache = VideoCache.read(where.videos);
  const corrections: Correction[] = existsSync(where.corrections)
    ? correctionsSchema.parse(
        JSON.parse(readFileSync(where.corrections, "utf8")),
      )
    : [];

  const files = new Map<number, SeasonFile>();
  const loadSeasons = () => {
    const seasons = new Set([
      seasonOf(now),
      ...state.schedule.map((game) => game.season),
    ]);
    for (const season of seasons) {
      if (files.has(season)) continue;
      const path = where.season(season);
      files.set(
        season,
        existsSync(path)
          ? parseSeasonFile(readFileSync(path, "utf8"))
          : { season, games: [] },
      );
    }
  };
  loadSeasons();

  const plannerState = (): PlannerState => ({
    schedule: state.schedule,
    games: [...files.values()].flatMap((file) => file.games),
    searched: new Set(
      [...files.values()]
        .flatMap((file) => file.games)
        .map(searchKey)
        .filter((key) => cache.searched(`game:${key}`)),
    ),
    lastScoreboardAt: state.lastScoreboardAt,
    lastCatchUpAt: state.lastCatchUpAt,
    lastUploadsAt: state.lastUploadsAt,
    lastSweepAt: state.lastSweepAt,
    quota: state.quota,
    quotaResetAt: nextPacificMidnight(now),
  });
  const due = plan(plannerState(), now);

  // ESPN.
  const watchedFinal = new Set<string>();
  if (due.scoreboard) {
    try {
      const read = await readScoreboards(
        options.fetchJson,
        due.scoreboard,
        state.schedule,
        now,
        teams,
      );
      const before = new Map(state.schedule.map((game) => [game.espnId, game]));
      for (const game of read) {
        const prior = before.get(game.espnId);
        if (
          game.status === "final" &&
          prior &&
          prior.status !== "final" &&
          now - prior.seenAt <= WATCHED_WITHIN_MS
        ) {
          watchedFinal.add(game.espnId);
        }
        before.set(game.espnId, toEntry(game, now));
      }
      state.schedule = [...before.values()].filter((game) => {
        const kickoff = Date.parse(game.kickoff);
        return (
          kickoff >= now - SCHEDULE_PAST_MS &&
          kickoff <= now + SCHEDULE_AHEAD_MS
        );
      });
      state.lastScoreboardAt = now;
      if (due.scoreboard === "catch-up") state.lastCatchUpAt = now;
      loadSeasons();
    } catch (error) {
      fail("ESPN", error);
    }
  }

  // YouTube.
  const youtube = options.youtube();
  const sweep = new Map<string, Video | null>();
  const games = () => [...files.values()].flatMap((file) => file.games);
  try {
    if (!state.quota.exhausted) {
      const searching = games().filter((game) => game.status === "searching");
      // A game final as of this pass is about to be tracked: it wants the
      // uploads now, not on the next pass.
      const tracked = new Set(games().map(searchKey));
      const newlyFinal = state.schedule.some(
        (game) =>
          game.status === "final" &&
          now < Date.parse(game.kickoff) + RECAP_WINDOW_MS &&
          !tracked.has(
            `${game.season} ${game.seasonType} ${game.week} ${game.away}@${game.home}`,
          ),
      );
      if (due.uploads || newlyFinal) {
        const since = new Date(
          Math.min(
            now - RECAP_WINDOW_MS,
            ...searching.map((game) => Date.parse(game.kickoff)),
          ),
        ).toISOString();
        const result = await collectNewUploads(
          youtube,
          cache,
          options.channelId,
          since,
          UPLOAD_PAGES,
        );
        state.lastUploadsAt = now;
        if (result.added > 0) log(`uploads: ${result.added} new`);
      }

      for (const game of due.searches) {
        const nickname = (code: string) =>
          teams.find((team) => team.abbreviation === code)?.nickname ?? code;
        const after = new Date(Date.parse(game.kickoff)).toISOString();
        const before = new Date(
          Math.min(now, Date.parse(game.kickoff) + RECAP_WINDOW_MS),
        ).toISOString();
        const videos = await youtube.searchWindow(
          options.channelId,
          after,
          before,
          `${nickname(game.away)} ${nickname(game.home)}`,
          SEARCH_PAGES,
        );
        cache.add(videos);
        cache.markSearched(`game:${searchKey(game)}`);
        state.quota.searches += 1;
        log(
          `searched ${searchKey(game)} (final ${new Date(finalAt(game)).toISOString()})`,
        );
      }

      // A video a correction names, if it was never gathered.
      const wanted = corrections
        .filter(
          (entry) =>
            entry.youtube_id !== null &&
            !cache.has(entry.youtube_id) &&
            tracked.has(
              `${entry.season} ${entry.season_type} ${entry.week} ${entry.away}@${entry.home}`,
            ),
        )
        .map((entry) => entry.youtube_id!);
      if (wanted.length > 0) {
        const fetched = await youtube.videos(wanted);
        cache.add([...fetched.values()]);
        for (const id of wanted) {
          if (!fetched.has(id)) fail("corrections", `${id} is not on YouTube`);
        }
      }

      if (due.sweep) {
        const linked = games().flatMap((game) =>
          game.status === "found" ? [game.video.youtube_id] : [],
        );
        const current = await youtube.videos(linked);
        // A takedown unlinks a recap, so one answer is not enough: what is
        // missing is asked about again before it counts as gone.
        const absent = linked.filter((id) => !current.has(id));
        if (absent.length > 0) {
          for (const [id, video] of await youtube.videos(absent)) {
            current.set(id, video);
          }
        }
        for (const id of linked) {
          const video = current.get(id) ?? null;
          sweep.set(id, video);
          if (video) cache.add([video]);
          else cache.delete(id);
        }
        state.lastSweepAt = now;
      }
    }
  } catch (error) {
    if (error instanceof YouTubeError && error.quotaExceeded) {
      state.quota.exhausted = true;
      fail("YouTube", "the day's quota is spent; waiting for midnight Pacific");
    } else {
      fail("YouTube", error);
    }
  } finally {
    state.quota.units += youtube.unitsSpent;
  }

  // What changed, a commit each.
  const { changes } = reconcile({
    league,
    now,
    files,
    schedule: state.schedule.flatMap((entry) => fromEntry(entry, teams)),
    watchedFinal,
    videos: cache.videos,
    corrections,
    sweep,
    teams,
  });
  const commits: string[] = [];
  for (const change of changes) {
    const next = applyChange(files.get(change.season)!, change);
    files.set(change.season, next);
    const path = where.season(change.season);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serializeSeasonFile(next));
    const file = `${league}/${change.season}.json`;
    try {
      await git.commit(
        [file],
        `${change.message}\n\nPublisher: ${options.build}`,
      );
    } catch (error) {
      // Left uncommitted, the file would stop every later pass.
      await git.discard([file]);
      throw error;
    }
    commits.push(change.message);
    log(change.message);
  }

  let unpushed = await git.unpushed();
  let pushed: boolean | null = null;
  if (options.push && unpushed > 0) {
    pushed = await git.push();
    if (pushed) unpushed = 0;
    else fail("push", "failed; the commits stay local for the next pass");
  }

  cache.write(where.videos);
  writeJson(where.state, state);
  const wakeAt = plan(plannerState(), now).wakeAt;
  const report: PassReport = {
    at: new Date(now).toISOString(),
    commits,
    pushed,
    unpushed,
    wakeAt,
    unitsToday: state.quota.units,
    errors,
  };
  writeStatus(where.status, report);
  return report;
}

/**
 * The season under way: the league year starts in March, so the Super Bowl
 * in February still belongs to the season before.
 */
export function seasonOf(at: number): number {
  const date = new Date(at);
  return date.getUTCMonth() >= 2
    ? date.getUTCFullYear()
    : date.getUTCFullYear() - 1;
}

async function readScoreboards(
  fetchJson: FetchJson,
  kind: "catch-up" | "live",
  schedule: readonly ScheduleEntry[],
  now: number,
  teams: readonly Team[],
): Promise<LiveGame[]> {
  const days = new Set<string>([easternDay(now)]);
  const urls: string[] = [];
  if (kind === "catch-up") {
    urls.push(CURRENT_SCOREBOARD_URL);
    for (let back = 1; back <= CATCH_UP_DAYS; back += 1) {
      days.add(easternDay(now - back * DAY));
    }
  } else {
    for (const game of schedule) {
      if (game.status === "scheduled" || game.status === "in_progress") {
        if (Date.parse(game.kickoff) <= now) days.add(easternDay(game.kickoff));
      }
    }
  }
  urls.push(...[...days].map(scoreboardDayUrl));
  const games = new Map<string, LiveGame>();
  for (const url of urls) {
    for (const game of gamesFromDay(await fetchJson(url), teams)) {
      games.set(game.espnId, game);
    }
  }
  return [...games.values()];
}

function toEntry(game: LiveGame, seenAt: number): ScheduleEntry {
  return {
    season: game.season,
    seasonType: game.seasonType,
    week: game.week,
    away: game.away.abbreviation,
    home: game.home.abbreviation,
    espnId: game.espnId,
    kickoff: game.kickoff,
    status: game.status,
    seenAt,
  };
}

function fromEntry(entry: ScheduleEntry, teams: readonly Team[]): LiveGame[] {
  const team = (code: string) => teams.find((t) => t.abbreviation === code);
  const away = team(entry.away);
  const home = team(entry.home);
  if (!away || !home) return [];
  return [
    {
      season: entry.season,
      seasonType: entry.seasonType,
      week: entry.week,
      kickoff: entry.kickoff,
      status: entry.status,
      away,
      home,
      espnId: entry.espnId,
    },
  ];
}

// ---------------------------------------------------------------------------
// Status, for a health check and the CLI

const statusSchema = z.object({
  lastPassAt: z.string(),
  nextWakeAt: z.string(),
  unitsToday: z.number(),
  unpushed: z.number(),
  lastCommit: z.string().optional(),
  lastError: z.string().optional(),
  lastErrorAt: z.string().optional(),
});
export type PublisherStatus = z.infer<typeof statusSchema>;

export function readStatus(path: string): PublisherStatus | null {
  if (!existsSync(path)) return null;
  return statusSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function writeStatus(path: string, report: PassReport): void {
  const prior = readStatus(path);
  const status: PublisherStatus = {
    lastPassAt: report.at,
    nextWakeAt: new Date(report.wakeAt).toISOString(),
    unitsToday: report.unitsToday,
    unpushed: report.unpushed,
    lastCommit: report.commits.at(-1) ?? prior?.lastCommit,
    lastError: report.errors.at(-1) ?? prior?.lastError,
    lastErrorAt: report.errors.length > 0 ? report.at : prior?.lastErrorAt,
  };
  writeJson(path, status);
}

function writeFailure(path: string, at: number, error: unknown): void {
  const prior = readStatus(path);
  writeJson(path, {
    lastPassAt: prior?.lastPassAt ?? new Date(at).toISOString(),
    nextWakeAt: new Date(at + RETRY_MS).toISOString(),
    unitsToday: prior?.unitsToday ?? 0,
    unpushed: prior?.unpushed ?? 0,
    lastCommit: prior?.lastCommit,
    lastError: error instanceof Error ? error.message : String(error),
    lastErrorAt: new Date(at).toISOString(),
  } satisfies PublisherStatus);
}

/**
 * Whether the publisher looks healthy: it passed recently, and is not long
 * past when it meant to wake. A stalled loop also shows in the data itself.
 */
export function healthy(status: PublisherStatus | null, now: number): boolean {
  if (!status) return false;
  const overdue = now - Date.parse(status.nextWakeAt);
  const sincePass = now - Date.parse(status.lastPassAt);
  return overdue < 10 * MINUTE && sincePass < 2 * 60 * MINUTE;
}

// ---------------------------------------------------------------------------
// The loop

/** Holds the publisher's lock, so only one runs per checkout. */
export function acquireLock(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(path);
        } catch {
          // Already gone.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(readFileSync(path, "utf8"));
      if (pid && pid !== process.pid && isAlive(pid)) {
        throw new Error(`Another publisher (pid ${pid}) holds ${path}`);
      }
      unlinkSync(path);
    }
  }
  throw new Error(`Could not take ${path}`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Passes until `signal` aborts, sleeping between them until the planner's
 * wake time. A failed pass is logged and retried in a few minutes.
 */
export async function runLoop(
  options: PublisherOptions,
  { signal, once = false }: { signal: AbortSignal; once?: boolean },
): Promise<void> {
  const where = paths(options.dataDir, options.league);
  const release = acquireLock(where.lock);
  try {
    while (!signal.aborted) {
      const now = Date.now();
      let wakeAt = now + RETRY_MS;
      try {
        const report = await runPass(options, now);
        wakeAt = report.wakeAt;
        options.log(
          `pass: ${report.commits.length} commits, ${report.unitsToday} units today, next ${new Date(wakeAt).toISOString()}`,
        );
      } catch (error) {
        options.log(
          `pass failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        writeFailure(where.status, now, error);
        if (once) throw error;
      }
      if (once) return;
      await sleep(Math.max(0, wakeAt - Date.now()), signal);
    }
  } finally {
    release();
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
