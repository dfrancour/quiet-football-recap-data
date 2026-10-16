import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatasetGame } from "../src/dataset.ts";
import {
  DAILY_UNITS,
  MAX_SEARCHES_PER_DAY,
  MAX_SLEEP_MS,
  nextPacificMidnight,
  pacificDay,
  plan,
  searchKey,
  stretched,
  uploadCadence,
  type PlannerState,
} from "../src/planner.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Sunday 2026-10-18, 16:20 UTC: the early games kicked off at 17:00. */
const SUNDAY = Date.parse("2026-10-18T16:20:00Z");
const t = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, "Z");

const game = (
  away: string,
  home: string,
  extra: Partial<DatasetGame> = {},
): DatasetGame =>
  ({
    season: 2026,
    season_type: "regular",
    week: 7,
    away,
    home,
    external_ids: { espn: `${away}${home}` },
    kickoff: "2026-10-18T17:00:00Z",
    status: "searching",
    ...extra,
  }) as DatasetGame;

const state = (extra: Partial<PlannerState> = {}): PlannerState => ({
  schedule: [],
  games: [],
  searched: new Set(),
  lastCatchUpAt: SUNDAY - HOUR,
  quota: { units: 0, searches: 0, exhausted: false },
  quotaResetAt: nextPacificMidnight(SUNDAY),
  ...extra,
});

describe("plan", () => {
  it("catches up with ESPN when it has never read it, and daily after", () => {
    assert.equal(
      plan(state({ lastCatchUpAt: undefined }), SUNDAY).scoreboard,
      "catch-up",
    );
    assert.equal(
      plan(state({ lastCatchUpAt: SUNDAY - DAY }), SUNDAY).scoreboard,
      "catch-up",
    );
    assert.equal(plan(state(), SUNDAY).scoreboard, null);
  });

  it("on a quiet day, sleeps until the first kickoff, at most an hour", () => {
    const schedule = [
      { kickoff: "2026-10-18T17:00:00Z", status: "scheduled" as const },
    ];
    const result = plan(state({ schedule }), SUNDAY);
    assert.equal(result.scoreboard, null);
    assert.equal(result.uploads, false);
    assert.equal(iso(result.wakeAt), "2026-10-18T17:00:00Z");
    const early = plan(state({ schedule }), SUNDAY - 3 * HOUR);
    assert.equal(early.wakeAt, SUNDAY - 3 * HOUR + MAX_SLEEP_MS);
  });

  it("reads ESPN every minute while a game is in play", () => {
    const now = t("2026-10-18T18:30:00Z");
    const schedule = [
      { kickoff: "2026-10-18T17:00:00Z", status: "in_progress" as const },
    ];
    const first = plan(
      state({ schedule, lastScoreboardAt: now - MINUTE }),
      now,
    );
    assert.equal(first.scoreboard, "live");
    const second = plan(
      state({ schedule, lastScoreboardAt: now - 20_000 }),
      now,
    );
    assert.equal(second.scoreboard, null);
    assert.equal(second.wakeAt, now + 40_000);
  });

  it("stops live reads for a game stuck short of final half a day on", () => {
    const now = t("2026-10-19T06:00:00Z");
    const schedule = [
      { kickoff: "2026-10-18T17:00:00Z", status: "in_progress" as const },
    ];
    assert.equal(plan(state({ schedule }), now).scoreboard, null);
  });

  it("three games just went final: read the uploads now, wake in a minute", () => {
    const now = t("2026-10-18T20:20:00Z");
    const finals = ["BUF", "DAL", "KC"].map((home) =>
      game("NYJ", home, { final_seen_at: "2026-10-18T20:15:00Z" }),
    );
    const result = plan(
      state({
        games: finals,
        lastScoreboardAt: now,
        lastUploadsAt: now - 5 * MINUTE,
      }),
      now,
    );
    assert.equal(result.uploads, true);

    const after = plan(
      state({ games: finals, lastScoreboardAt: now, lastUploadsAt: now }),
      now,
    );
    assert.equal(after.uploads, false);
    assert.equal(after.wakeAt, now + MINUTE);
  });

  it("slows the uploads as the searching games age", () => {
    assert.equal(uploadCadence(30 * MINUTE, 0), MINUTE);
    assert.equal(uploadCadence(3 * HOUR, 0), 5 * MINUTE);
    assert.equal(uploadCadence(10 * HOUR, 0), 30 * MINUTE);
    assert.equal(uploadCadence(2 * DAY, 0), 3 * HOUR);
  });

  it("follows the youngest searching game", () => {
    const now = t("2026-10-19T01:00:00Z");
    const games = [
      game("NYJ", "BUF", { final_seen_at: "2026-10-18T20:15:00Z" }),
      game("SF", "LAR", { final_seen_at: "2026-10-19T00:40:00Z" }),
    ];
    const result = plan(state({ games, lastUploadsAt: now - MINUTE }), now);
    assert.equal(result.uploads, true);
  });

  it("assumes a typical game length for a game it did not see go final", () => {
    const now = t("2026-10-18T21:00:00Z");
    const games = [game("NYJ", "BUF")];
    // Final assumed at 20:30, so half an hour on: every minute.
    assert.equal(
      plan(state({ games, lastUploadsAt: now - MINUTE }), now).uploads,
      true,
    );
  });

  it("reads no uploads with nothing searching", () => {
    const games = [game("NYJ", "BUF", { status: "missing" })];
    assert.equal(plan(state({ games }), SUNDAY).uploads, false);
  });

  it("searches a game's window once, twelve hours after final", () => {
    const final = "2026-10-18T20:15:00Z";
    const games = [game("NYJ", "BUF", { final_seen_at: final })];
    const before = plan(
      state({ games, lastUploadsAt: t(final) + 11 * HOUR }),
      t(final) + 11 * HOUR,
    );
    assert.deepEqual(before.searches, []);
    assert.ok(before.wakeAt <= t(final) + 12 * HOUR);

    const at = t(final) + 12 * HOUR;
    assert.deepEqual(
      plan(state({ games, lastUploadsAt: at }), at).searches,
      games,
    );

    const searched = new Set([searchKey(games[0]!)]);
    assert.deepEqual(
      plan(state({ games, searched, lastUploadsAt: at }), at).searches,
      [],
    );
  });

  it("caps the day's searches", () => {
    const final = "2026-10-18T20:15:00Z";
    const teams = [
      "ARI",
      "ATL",
      "BAL",
      "CAR",
      "CHI",
      "CIN",
      "CLE",
      "DEN",
      "DET",
      "GB",
      "HOU",
      "IND",
      "JAX",
      "LV",
      "LAC",
      "LAR",
      "MIA",
      "MIN",
      "NE",
      "NO",
      "NYG",
      "PHI",
    ];
    const games = teams.map((home) =>
      game("SEA", home, { final_seen_at: final }),
    );
    const at = t(final) + 13 * HOUR;
    const result = plan(state({ games, lastUploadsAt: at }), at);
    assert.equal(result.searches.length, MAX_SEARCHES_PER_DAY);
    const spent = plan(
      state({
        games,
        lastUploadsAt: at,
        quota: { units: 3000, searches: 20, exhausted: false },
      }),
      at,
    );
    assert.deepEqual(spent.searches, []);
  });

  it("sweeps linked videos weekly", () => {
    const games = [
      game("NYJ", "BUF", { status: "found" } as Partial<DatasetGame>),
    ];
    assert.equal(plan(state({ games }), SUNDAY).sweep, true);
    assert.equal(
      plan(state({ games, lastSweepAt: SUNDAY - DAY }), SUNDAY).sweep,
      false,
    );
    assert.equal(
      plan(state({ games, lastSweepAt: SUNDAY - 7 * DAY }), SUNDAY).sweep,
      true,
    );
  });

  it("wakes when a searching game's window closes", () => {
    const games = [
      game("NYJ", "BUF", {
        kickoff: "2026-10-15T17:00:00Z",
        final_seen_at: "2026-10-15T20:30:00Z",
      }),
    ];
    const now = t("2026-10-18T16:50:00Z");
    const result = plan(
      state({
        games,
        lastUploadsAt: now,
        searched: new Set([searchKey(games[0]!)]),
        lastSweepAt: now,
      }),
      now,
    );
    assert.equal(iso(result.wakeAt), "2026-10-18T17:00:00Z");
  });

  it("with the quota spent, does nothing on YouTube until it resets", () => {
    const now = t("2026-10-18T21:00:00Z");
    const games = [
      game("NYJ", "BUF", { final_seen_at: "2026-10-18T20:15:00Z" }),
    ];
    const result = plan(
      state({
        games,
        quota: { units: DAILY_UNITS, searches: 0, exhausted: true },
        quotaResetAt: now + 10 * MINUTE,
      }),
      now,
    );
    assert.equal(result.uploads, false);
    assert.equal(result.sweep, false);
    assert.equal(result.wakeAt, now + 10 * MINUTE);
  });

  it("never wakes sooner than half a minute", () => {
    const now = t("2026-10-18T21:00:00Z");
    const games = [
      game("NYJ", "BUF", { final_seen_at: "2026-10-18T20:15:00Z" }),
    ];
    const result = plan(state({ games, lastUploadsAt: now - 50_000 }), now);
    assert.equal(result.wakeAt, now + 30_000);
  });
});

describe("stretched", () => {
  it("keeps the first two hours' minute until the last tenth of the budget", () => {
    assert.equal(stretched(MINUTE, 0.8 * DAILY_UNITS), MINUTE);
    assert.equal(stretched(MINUTE, 0.9 * DAILY_UNITS), 30 * MINUTE);
  });

  it("stretches the long tail first", () => {
    assert.equal(stretched(5 * MINUTE, 0.4 * DAILY_UNITS), 5 * MINUTE);
    assert.equal(stretched(5 * MINUTE, 0.6 * DAILY_UNITS), 10 * MINUTE);
    assert.equal(stretched(5 * MINUTE, 0.8 * DAILY_UNITS), 20 * MINUTE);
  });
});

describe("Pacific time", () => {
  it("names the day the quota is counted in", () => {
    assert.equal(pacificDay(t("2026-10-16T06:59:00Z")), "2026-10-15");
    assert.equal(pacificDay(t("2026-10-16T07:00:00Z")), "2026-10-16");
  });

  it("finds the next midnight, across daylight saving too", () => {
    assert.equal(
      iso(nextPacificMidnight(t("2026-10-15T22:00:00Z"))),
      "2026-10-16T07:00:00Z",
    );
    assert.equal(
      iso(nextPacificMidnight(t("2026-11-01T22:00:00Z"))),
      "2026-11-02T08:00:00Z",
    );
  });
});
