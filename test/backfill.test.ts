import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { backfillSeason, lostRecaps } from "../src/backfill.ts";
import { correctionsSchema, type Correction } from "../src/corrections.ts";
import {
  gameName,
  instant,
  serializeSeasonFile,
  type DatasetGame,
} from "../src/dataset.ts";
import type { ScheduledGame } from "../src/espn.ts";
import type { Video } from "../src/matcher.ts";
import { NFL_TEAMS, nflTeam } from "../src/nfl/teams.ts";

function scheduled(
  espnId: string,
  away: string,
  home: string,
  overrides: Partial<ScheduledGame> = {},
): ScheduledGame {
  return {
    seasonType: "regular",
    week: 6,
    kickoff: "2026-10-11T17:00Z",
    status: "final",
    away: nflTeam(away),
    home: nflTeam(home),
    espnId,
    ...overrides,
  };
}

const recap: Video = {
  youtubeId: "GP9zR_SKRr0",
  title: "Kansas City Chiefs vs. Buffalo Bills Game Highlights | 2026 Week 6",
  publishedAt: "2026-10-11T20:41:07.000Z",
};

const backfill = (
  schedule: ScheduledGame[],
  videos: Video[] = [recap],
  corrections: Correction[] = [],
) => backfillSeason(2026, schedule, videos, corrections, NFL_TEAMS);

describe("backfillSeason", () => {
  it("links a final game's recap, with no observed times", () => {
    const [game] = backfill([scheduled("401", "KC", "BUF")]).games;
    assert.deepEqual(game, {
      season: 2026,
      season_type: "regular",
      week: 6,
      away: "KC",
      home: "BUF",
      external_ids: { espn: "401" },
      kickoff: "2026-10-11T17:00:00Z",
      status: "found",
      video: {
        youtube_id: "GP9zR_SKRr0",
        title: recap.title,
        published_at: "2026-10-11T20:41:07Z",
      },
    });
  });

  it("marks a final game without a recap unknown, never missing", () => {
    const [game] = backfill([scheduled("402", "DAL", "PHI")]).games;
    assert.equal(game?.status, "unknown");
  });

  it("leaves out games that are not final", () => {
    const file = backfill([
      scheduled("403", "KC", "BUF", { status: "postponed" }),
      scheduled("404", "DAL", "PHI", { status: "canceled" }),
      scheduled("405", "SF", "SEA", { status: "scheduled" }),
    ]);
    assert.deepEqual(file.games, []);
  });

  describe("corrections", () => {
    const correction = (youtube_id: string | null): Correction => ({
      season: 2026,
      season_type: "regular",
      week: 6,
      away: "KC",
      home: "BUF",
      youtube_id,
      reason: "test",
    });
    const other: Video = {
      youtubeId: "other000000",
      title: "Chiefs at Bills: the full story",
      publishedAt: "2026-10-12T02:00:00Z",
    };

    it("links the video a person chose over the matcher's", () => {
      const [game] = backfill(
        [scheduled("401", "KC", "BUF")],
        [recap, other],
        [correction("other000000")],
      ).games;
      assert.equal(
        game?.status === "found" && game.video.youtube_id,
        "other000000",
      );
    });

    it("leaves a game unlinked when a person says it has no recap", () => {
      const [game] = backfill(
        [scheduled("401", "KC", "BUF")],
        [recap],
        [correction(null)],
      ).games;
      assert.equal(game?.status, "unknown");
    });

    it("fails when the chosen video was never gathered", () => {
      assert.throws(
        () =>
          backfill(
            [scheduled("401", "KC", "BUF")],
            [recap],
            [correction("absent00000")],
          ),
        /absent00000, which is not among the videos/,
      );
    });

    it("applies only to its own game", () => {
      const [game] = backfill(
        [scheduled("401", "KC", "BUF", { week: 7 })],
        [recap],
        [correction(null)],
      ).games;
      assert.equal(game?.status, "found");
    });
  });
});

describe("the season file", () => {
  const game = (overrides: Partial<DatasetGame>): DatasetGame =>
    ({
      season: 2026,
      season_type: "regular",
      week: 6,
      away: "KC",
      home: "BUF",
      external_ids: { espn: "401" },
      kickoff: "2026-10-11T17:00:00Z",
      status: "unknown",
      ...overrides,
    }) as DatasetGame;

  it("sorts by season type, week, kickoff and home team", () => {
    const text = serializeSeasonFile({
      season: 2026,
      games: [
        game({ week: 2, home: "PHI" }),
        game({ season_type: "postseason", week: 19 }),
        game({ week: 2, home: "BUF" }),
        game({ season_type: "preseason", week: 3 }),
      ],
    });
    const order = JSON.parse(text).games.map(
      (g: DatasetGame) => `${g.season_type} ${g.week} ${g.home}`,
    );
    assert.deepEqual(order, [
      "preseason 3 BUF",
      "regular 2 BUF",
      "regular 2 PHI",
      "postseason 19 BUF",
    ]);
  });

  it("writes keys in schema order, whatever order they arrive in", () => {
    const shuffled = {
      status: "found",
      video: {
        published_at: "2026-10-11T20:41:07Z",
        title: "t",
        youtube_id: "GP9zR_SKRr0",
      },
      kickoff: "2026-10-11T17:00:00Z",
      external_ids: { espn: "401" },
      home: "BUF",
      away: "KC",
      week: 6,
      season_type: "regular",
      season: 2026,
    } as DatasetGame;
    const [written] = JSON.parse(
      serializeSeasonFile({ season: 2026, games: [shuffled] }),
    ).games;
    assert.deepEqual(Object.keys(written), [
      "season",
      "season_type",
      "week",
      "away",
      "home",
      "external_ids",
      "kickoff",
      "status",
      "video",
    ]);
    assert.deepEqual(Object.keys(written.video), [
      "youtube_id",
      "title",
      "published_at",
    ]);
  });

  it("is the same bytes when written twice", () => {
    const file = { season: 2026, games: [game({}), game({ week: 3 })] };
    assert.equal(serializeSeasonFile(file), serializeSeasonFile(file));
    assert.match(
      serializeSeasonFile(file),
      /^\{\n {2}"\$schema": "\.\/schema\.json",/,
    );
    assert.match(serializeSeasonFile(file), /\}\n$/);
  });

  it("names a game the way commit messages do", () => {
    assert.equal(gameName("nfl", game({})), "nfl 2026 W6 KC@BUF");
    assert.equal(
      gameName("nfl", game({ season_type: "preseason", week: 3 })),
      "nfl 2026 PRE W3 KC@BUF",
    );
  });

  it("writes instants to the second", () => {
    assert.equal(instant("2026-10-13T00:15Z"), "2026-10-13T00:15:00Z");
    assert.equal(instant("2026-10-13T04:10:35.123Z"), "2026-10-13T04:10:35Z");
  });
});

describe("nfl/corrections.json", () => {
  it("is a valid list of corrections, at most one per game", () => {
    const corrections = correctionsSchema.parse(
      JSON.parse(
        readFileSync(
          new URL("../nfl/corrections.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    const games = corrections.map(
      (c) => `${c.season} ${c.season_type} ${c.week} ${c.away}@${c.home}`,
    );
    assert.equal(new Set(games).size, games.length);
  });
});

describe("lostRecaps", () => {
  const found = (week: number, away: string, home: string) => ({
    season_type: "regular",
    week,
    away,
    home,
    status: "found",
  });
  const unknown = (week: number, away: string, home: string) => ({
    ...found(week, away, home),
    status: "unknown",
  });

  it("names the games found before and not now", () => {
    const before = { games: [found(5, "BUF", "LAR"), found(5, "SF", "SEA")] };
    const after = {
      games: [
        found(5, "BUF", "LAR"),
        unknown(5, "SF", "SEA"),
        found(6, "SEA", "DEN"),
      ],
    };
    assert.deepEqual(lostRecaps(before, after), ["W5 SF@SEA"]);
  });

  it("loses nothing when there was no file, or a game is only added", () => {
    const after = { games: [found(6, "SEA", "DEN")] };
    assert.deepEqual(lostRecaps(null, after), []);
    assert.deepEqual(lostRecaps({ games: [] }, after), []);
  });

  it("tells preseason weeks from regular ones", () => {
    const pre = { ...found(3, "CHI", "TEN"), season_type: "preseason" };
    assert.deepEqual(
      lostRecaps({ games: [pre] }, { games: [found(3, "CHI", "TEN")] }),
      ["PRE W3 CHI@TEN"],
    );
  });
});
