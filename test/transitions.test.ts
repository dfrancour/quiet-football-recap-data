import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Correction } from "../src/corrections.ts";
import type { DatasetGame, SeasonFile } from "../src/dataset.ts";
import type { GameStatus, LiveGame } from "../src/espn.ts";
import type { Video } from "../src/matcher.ts";
import { NFL_TEAMS, nflTeam } from "../src/nfl/teams.ts";
import {
  applyChange,
  reconcile,
  type ReconcileInput,
} from "../src/transitions.ts";

const KICKOFF = "2026-10-16T00:15:00Z";
const HOUR = 3_600_000;
const at = (hours: number) => Date.parse(KICKOFF) + hours * HOUR;

const live = (status: GameStatus, away = "SEA", home = "DEN"): LiveGame => ({
  season: 2026,
  seasonType: "regular",
  week: 6,
  kickoff: KICKOFF,
  status,
  away: nflTeam(away),
  home: nflTeam(home),
  espnId: "401872995",
});

const searching = (extra: Partial<DatasetGame> = {}): DatasetGame =>
  ({
    season: 2026,
    season_type: "regular",
    week: 6,
    away: "SEA",
    home: "DEN",
    external_ids: { espn: "401872995" },
    kickoff: KICKOFF,
    status: "searching",
    final_seen_at: "2026-10-16T03:20:00Z",
    ...extra,
  }) as DatasetGame;

const recap: Video = {
  youtubeId: "6uFD3NGt0GE",
  title:
    "Seattle Seahawks vs Denver Broncos Game Highlights | 2026 NFL Season Week 6",
  publishedAt: "2026-10-16T03:46:56Z",
};

const found = (extra: Partial<DatasetGame> = {}): DatasetGame =>
  searching({
    status: "found",
    video: {
      youtube_id: recap.youtubeId,
      title: recap.title,
      published_at: recap.publishedAt,
    },
    detected_at: "2026-10-16T03:47:00Z",
    ...extra,
  } as Partial<DatasetGame>);

function run(overrides: Partial<ReconcileInput> & { games?: DatasetGame[] }) {
  const { games = [], ...rest } = overrides;
  return reconcile({
    league: "nfl",
    now: at(4),
    files: new Map([[2026, { season: 2026, games }]]),
    schedule: [],
    watchedFinal: new Set(),
    videos: [],
    corrections: [],
    sweep: new Map(),
    teams: NFL_TEAMS,
    ...rest,
  });
}

const messages = (result: ReturnType<typeof reconcile>) =>
  result.changes.map((change) => change.message);

describe("reconcile", () => {
  it("tracks a game it watched go final, with when", () => {
    const result = run({
      now: Date.parse("2026-10-16T03:20:30Z"),
      schedule: [live("final")],
      watchedFinal: new Set(["401872995"]),
    });
    assert.deepEqual(messages(result), [
      "track(nfl 2026 W6 SEA@DEN): final, searching",
    ]);
    assert.deepEqual(result.changes[0]!.next, {
      ...searching(),
      final_seen_at: "2026-10-16T03:20:30Z",
    });
  });

  it("leaves out when it went final if it did not watch it happen", () => {
    const result = run({ schedule: [live("final")] });
    const next = result.changes[0]!.next!;
    assert.equal(next.status, "searching");
    assert.equal("final_seen_at" in next, false);
  });

  it("does not track a game that is not final, nor one already tracked", () => {
    assert.deepEqual(
      messages(run({ schedule: [live("in_progress"), live("scheduled")] })),
      [],
    );
    assert.deepEqual(
      messages(run({ games: [searching()], schedule: [live("final")] })),
      [],
    );
  });

  it("tracks a game first seen after its window as unknown, never missing", () => {
    const result = run({ now: at(80), schedule: [live("final")] });
    assert.deepEqual(messages(result), [
      "track(nfl 2026 W6 SEA@DEN): final after its window closed, unknown",
    ]);
    assert.equal(result.changes[0]!.next!.status, "unknown");
  });

  it("untracks a searching game ESPN no longer calls final", () => {
    const result = run({
      games: [searching()],
      schedule: [live("in_progress")],
    });
    assert.deepEqual(messages(result), [
      "untrack(nfl 2026 W6 SEA@DEN): no longer final",
    ]);
    assert.equal(result.changes[0]!.next, null);
    assert.deepEqual(result.files.get(2026)!.games, []);
  });

  it("adds a recap, with when it was detected", () => {
    const result = run({ games: [searching()], videos: [recap] });
    assert.deepEqual(messages(result), [
      `add(nfl 2026 W6 SEA@DEN): 6uFD3NGt0GE "${recap.title}"`,
    ]);
    assert.deepEqual(result.changes[0]!.next, {
      ...searching(),
      status: "found",
      video: {
        youtube_id: recap.youtubeId,
        title: recap.title,
        published_at: recap.publishedAt,
      },
      detected_at: "2026-10-16T04:15:00Z",
    });
  });

  it("tracks and adds in one pass, as two changes", () => {
    const result = run({ schedule: [live("final")], videos: [recap] });
    assert.deepEqual(
      result.changes.map((change) => change.next?.status),
      ["searching", "found"],
    );
  });

  it("ignores videos that are not this game's recap", () => {
    const others: Video[] = [
      {
        ...recap,
        youtubeId: "a".repeat(11),
        title: "Seahawks vs. Broncos Preview",
      },
      {
        ...recap,
        youtubeId: "b".repeat(11),
        title: "Chiefs vs. Bills Game Highlights",
      },
    ];
    assert.deepEqual(
      messages(run({ games: [searching()], videos: others })),
      [],
    );
  });

  it("trades its own find for the game's highlights while the window is open", () => {
    const reel: Video = {
      youtubeId: "c".repeat(11),
      title: "Seahawks vs. Broncos highlights: every Geno Smith throw",
      publishedAt: "2026-10-16T03:40:00Z",
    };
    const current = found({
      video: {
        youtube_id: reel.youtubeId,
        title: reel.title,
        published_at: reel.publishedAt,
      },
    } as Partial<DatasetGame>);
    const result = run({ games: [current], videos: [reel, recap] });
    assert.deepEqual(messages(result), [
      "correct(nfl 2026 W6 SEA@DEN): ccccccccccc -> 6uFD3NGt0GE, reason=game-highlights",
    ]);
  });

  it("keeps a backfilled match, and a match once the window has closed", () => {
    const better = { ...recap, youtubeId: "d".repeat(11) };
    const backfilled = found({ detected_at: undefined });
    delete (backfilled as { detected_at?: string }).detected_at;
    assert.deepEqual(
      messages(run({ games: [backfilled], videos: [better, recap] })),
      [],
    );
    assert.deepEqual(
      messages(run({ now: at(80), games: [found()], videos: [recap] })),
      [],
    );
  });

  it("misses a game still searching when the window closes", () => {
    const result = run({ now: at(72), games: [searching()] });
    assert.deepEqual(messages(result), [
      "miss(nfl 2026 W6 SEA@DEN): window closed",
    ]);
    assert.equal(result.changes[0]!.next!.status, "missing");
  });

  describe("corrections", () => {
    const correction = (youtube_id: string | null): Correction => ({
      season: 2026,
      season_type: "regular",
      week: 6,
      away: "SEA",
      home: "DEN",
      youtube_id,
      reason: "wrong-match",
    });
    const other: Video = { ...recap, youtubeId: "e".repeat(11) };

    it("links the video a person chose, over the matcher", () => {
      const result = run({
        games: [found()],
        videos: [recap, other],
        corrections: [correction(other.youtubeId)],
      });
      assert.deepEqual(messages(result), [
        "correct(nfl 2026 W6 SEA@DEN): 6uFD3NGt0GE -> eeeeeeeeeee, reason=wrong-match",
      ]);
      const next = result.changes[0]!.next!;
      assert.equal(
        next.status === "found" && next.video.youtube_id,
        other.youtubeId,
      );
      assert.equal("detected_at" in next, false);
    });

    it("links it to a searching game too, and then leaves it be", () => {
      const first = run({
        games: [searching()],
        videos: [recap, other],
        corrections: [correction(other.youtubeId)],
      });
      assert.deepEqual(messages(first), [
        "correct(nfl 2026 W6 SEA@DEN): searching -> eeeeeeeeeee, reason=wrong-match",
      ]);
      const again = run({
        games: first.files.get(2026)!.games,
        videos: [recap, other],
        corrections: [correction(other.youtubeId)],
      });
      assert.deepEqual(messages(again), []);
    });

    it("removes a match a person says is no recap, and never matches it again", () => {
      const result = run({
        games: [found()],
        videos: [recap],
        corrections: [correction(null)],
      });
      assert.deepEqual(messages(result), [
        "remove(nfl 2026 W6 SEA@DEN): reason=wrong-match",
      ]);
      assert.equal(result.changes[0]!.next!.status, "searching");
    });

    it("waits for a corrected video it has not gathered", () => {
      const result = run({
        games: [found()],
        videos: [recap],
        corrections: [correction(other.youtubeId)],
      });
      assert.deepEqual(messages(result), []);
    });
  });

  describe("the sweep", () => {
    it("retitles a linked video", () => {
      const result = run({
        games: [found()],
        videos: [recap],
        sweep: new Map([[recap.youtubeId, { ...recap, title: "New title" }]]),
      });
      assert.deepEqual(messages(result), [
        `retitle(nfl 2026 W6 SEA@DEN): "${recap.title}" -> "New title"`,
      ]);
    });

    it("removes a takedown, and links a replacement in the same pass", () => {
      const replacement = { ...recap, youtubeId: "f".repeat(11) };
      const result = run({
        games: [found()],
        videos: [recap, replacement],
        sweep: new Map([[recap.youtubeId, null]]),
      });
      assert.deepEqual(messages(result), [
        "remove(nfl 2026 W6 SEA@DEN): reason=taken-down",
        `add(nfl 2026 W6 SEA@DEN): fffffffffff "${recap.title}"`,
      ]);
    });

    it("after the window, a takedown is missing if watched, unknown if not", () => {
      const sweep = new Map([[recap.youtubeId, null]]);
      const watched = run({ now: at(100), games: [found()], sweep });
      assert.equal(watched.changes[0]!.next!.status, "missing");
      const backfilled = found();
      delete (backfilled as { detected_at?: string }).detected_at;
      const unwatched = run({ now: at(100), games: [backfilled], sweep });
      assert.equal(unwatched.changes[0]!.next!.status, "unknown");
    });
  });
});

describe("applyChange", () => {
  it("replaces, adds and removes one game", () => {
    const file: SeasonFile = { season: 2026, games: [searching()] };
    const key = "regular 6 SEA@DEN";
    const replaced = applyChange(file, {
      season: 2026,
      key,
      next: found(),
      message: "",
    });
    assert.deepEqual(replaced.games, [found()]);
    const removed = applyChange(file, {
      season: 2026,
      key,
      next: null,
      message: "",
    });
    assert.deepEqual(removed.games, []);
  });
});
