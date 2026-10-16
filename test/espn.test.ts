import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  easternDay,
  fetchSeasonSchedule,
  gamesFromDay,
  gamesFromScoreboard,
  regularSeasonWeeks,
  scoreboardUrl,
} from "../src/espn.ts";
import { NFL_TEAMS, nflTeam } from "../src/nfl/teams.ts";

interface EventSpec {
  id: string;
  away: string;
  home: string;
  date?: string;
  status?: { name?: string; state?: string };
  headline?: string;
}

/** A hand-written scoreboard: only the fields the reader trusts. */
function scoreboard(...events: EventSpec[]) {
  return {
    events: events.map((event) => ({
      id: event.id,
      date: event.date ?? "2026-10-11T17:00Z",
      competitions: [
        {
          competitors: [
            { homeAway: "home", team: { id: espnIdOf(event.home) } },
            { homeAway: "away", team: { id: espnIdOf(event.away) } },
          ],
          status: { type: event.status ?? { name: "STATUS_FINAL" } },
          notes: event.headline ? [{ headline: event.headline }] : [],
        },
      ],
    })),
  };
}

/** A team's ESPN id, or the raw id for ESPN's stand-ins ("-1", "31"). */
function espnIdOf(team: string): string {
  return /^-?\d+$/.test(team) ? team : nflTeam(team).espnId;
}

const read = (
  payload: unknown,
  season: number,
  seasonType: "preseason" | "regular" | "postseason",
  week: number,
) => gamesFromScoreboard(payload, season, seasonType, week, NFL_TEAMS);

describe("regularSeasonWeeks", () => {
  it("is 17 through 2020 and 18 since", () => {
    assert.equal(regularSeasonWeeks(2020), 17);
    assert.equal(regularSeasonWeeks(2021), 18);
  });
});

describe("scoreboardUrl", () => {
  it("names ESPN's season type by number", () => {
    assert.match(scoreboardUrl(2026, "preseason", 1), /seasontype=1&week=1$/);
    assert.match(scoreboardUrl(2026, "regular", 6), /dates=2026&seasontype=2/);
    assert.match(scoreboardUrl(2026, "postseason", 5), /seasontype=3&week=5$/);
  });
});

describe("gamesFromScoreboard", () => {
  it("reads a game's teams, kickoff, status and ESPN id", () => {
    const [game] = read(
      scoreboard({ id: "401772936", away: "KC", home: "BUF" }),
      2026,
      "regular",
      6,
    );
    assert.deepEqual(game, {
      seasonType: "regular",
      week: 6,
      kickoff: "2026-10-11T17:00Z",
      status: "final",
      home: nflTeam("BUF"),
      away: nflTeam("KC"),
      espnId: "401772936",
    });
  });

  it("keeps the week asked for in the preseason, Hall of Fame game as 1", () => {
    const [game] = read(
      scoreboard({ id: "1", away: "LAC", home: "DET" }),
      2025,
      "preseason",
      1,
    );
    assert.equal(game?.seasonType, "preseason");
    assert.equal(game?.week, 1);
  });

  it("continues the regular season's count into the postseason", () => {
    const wildCard = scoreboard({ id: "1", away: "PIT", home: "BAL" });
    assert.equal(read(wildCard, 2024, "postseason", 1)[0]?.week, 19);
    assert.equal(read(wildCard, 2019, "postseason", 1)[0]?.week, 18);
    assert.equal(read(wildCard, 2024, "postseason", 3)[0]?.week, 21);
  });

  it("finds the Super Bowl by its headline and drops the Pro Bowl", () => {
    const superBowl = scoreboard({
      id: "1",
      away: "KC",
      home: "PHI",
      headline: "Super Bowl LIX",
    });
    const proBowl = scoreboard({
      id: "2",
      away: "31",
      home: "32",
      headline: "Pro Bowl Games",
    });
    assert.equal(read(superBowl, 2024, "postseason", 5)[0]?.week, 22);
    assert.equal(read(superBowl, 2014, "postseason", 4)[0]?.week, 21);
    assert.deepEqual(read(proBowl, 2024, "postseason", 4), []);
  });

  it("drops a postseason game that is neither a round nor the Super Bowl", () => {
    assert.deepEqual(
      read(
        scoreboard({ id: "1", away: "KC", home: "PHI" }),
        2024,
        "postseason",
        4,
      ),
      [],
    );
  });

  it("drops a matchup ESPN has not set", () => {
    assert.deepEqual(
      read(
        scoreboard({ id: "1", away: "-1", home: "-2" }),
        2026,
        "postseason",
        2,
      ),
      [],
    );
  });

  it("reads ESPN's statuses, falling back on its state", () => {
    const status = (type: { name?: string; state?: string }) =>
      read(
        scoreboard({ id: "1", away: "KC", home: "BUF", status: type }),
        2026,
        "regular",
        6,
      )[0]?.status;
    assert.equal(status({ name: "STATUS_FINAL" }), "final");
    assert.equal(status({ name: "STATUS_HALFTIME" }), "in_progress");
    assert.equal(status({ name: "STATUS_POSTPONED" }), "postponed");
    assert.equal(status({ name: "STATUS_CANCELED" }), "canceled");
    assert.equal(
      status({ name: "STATUS_FINAL_OVERTIME", state: "post" }),
      "final",
    );
    assert.equal(
      status({ name: "STATUS_DELAYED", state: "in" }),
      "in_progress",
    );
    assert.equal(
      status({ name: "STATUS_SCHEDULED", state: "pre" }),
      "scheduled",
    );
  });

  it("throws on a payload it cannot read", () => {
    assert.throws(
      () => read({ events: "nope" }, 2026, "regular", 6),
      /unreadable/,
    );
    assert.throws(() => read(null, 2026, "regular", 6), /unreadable/);
  });
});

describe("fetchSeasonSchedule", () => {
  function stub(weeks: Record<string, unknown>) {
    const asked: string[] = [];
    const fetchJson = async (url: string) => {
      asked.push(url);
      const key = /seasontype=(\d)&week=(\d+)/.exec(url)!.slice(1).join("-");
      return weeks[key] ?? scoreboard();
    };
    return { asked, fetchJson };
  }

  const everyRegularWeek = (season: number) =>
    Object.fromEntries(
      Array.from({ length: regularSeasonWeeks(season) }, (_, i) => [
        `2-${i + 1}`,
        scoreboard({ id: `r${i + 1}`, away: "KC", home: "BUF" }),
      ]),
    );

  it("reads preseason, regular season and postseason in order", async () => {
    const { asked, fetchJson } = stub({
      ...everyRegularWeek(2026),
      "1-1": scoreboard({ id: "hof", away: "LAC", home: "DET" }),
      "3-5": scoreboard({
        id: "sb",
        away: "KC",
        home: "PHI",
        headline: "Super Bowl LXI",
      }),
    });
    const games = await fetchSeasonSchedule(2026, {
      teams: NFL_TEAMS,
      fetchJson,
      pauseMs: 0,
    });
    assert.equal(asked.length, 5 + 18 + 5);
    assert.deepEqual(
      [games[0]?.espnId, games[1]?.espnId, games.at(-1)?.espnId],
      ["hof", "r1", "sb"],
    );
    assert.equal(games.at(-1)?.week, 22);
  });

  it("fails rather than drop a regular-season week that comes back empty", async () => {
    const weeks = everyRegularWeek(2026);
    delete weeks["2-7"];
    const { fetchJson } = stub(weeks);
    await assert.rejects(
      fetchSeasonSchedule(2026, { teams: NFL_TEAMS, fetchJson, pauseMs: 0 }),
      /no games for 2026 week 7/,
    );
  });
});

describe("gamesFromDay", () => {
  /** A day's scoreboard, where each event says its season and week. */
  const day = (
    ...events: (EventSpec & { year?: number; type?: number; week?: number })[]
  ) => ({
    events: scoreboard(...events).events.map((event, index) => ({
      ...event,
      season: {
        year: events[index]!.year ?? 2026,
        type: events[index]!.type ?? 2,
      },
      week: { number: events[index]!.week ?? 6 },
    })),
  });

  it("reads each game's own season, type and week", () => {
    const [game] = gamesFromDay(
      day({
        id: "401872995",
        away: "SEA",
        home: "DEN",
        date: "2026-10-16T00:15Z",
      }),
      NFL_TEAMS,
    );
    assert.equal(game!.season, 2026);
    assert.equal(game!.seasonType, "regular");
    assert.equal(game!.week, 6);
    assert.equal(game!.status, "final");
    assert.equal(game!.away.abbreviation, "SEA");
  });

  it("continues the regular season's count into the postseason", () => {
    const games = gamesFromDay(
      day(
        { id: "1", away: "LAR", home: "CAR", year: 2025, type: 3, week: 1 },
        {
          id: "2",
          away: "SEA",
          home: "NE",
          year: 2025,
          type: 3,
          week: 5,
          headline: "Super Bowl LX",
        },
        {
          id: "3",
          away: "-1",
          home: "-2",
          year: 2025,
          type: 3,
          week: 4,
          headline: "Pro Bowl",
        },
      ),
      NFL_TEAMS,
    );
    assert.deepEqual(
      games.map((game) => [game.season, game.week]),
      [
        [2025, 19],
        [2025, 22],
      ],
    );
  });

  it("drops an event that does not say its season", () => {
    assert.deepEqual(
      gamesFromDay(
        scoreboard({ id: "1", away: "SEA", home: "DEN" }),
        NFL_TEAMS,
      ),
      [],
    );
  });
});

describe("easternDay", () => {
  it("names the day as ESPN counts it, in US Eastern time", () => {
    assert.equal(easternDay("2026-10-16T00:15:00Z"), "20261015");
    assert.equal(easternDay("2026-10-16T04:00:00Z"), "20261016");
  });
});
