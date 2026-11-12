import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatasetGame, SeasonFile } from "../src/dataset.ts";
import {
  buildFeeds,
  entryTitle,
  feedIndex,
  roundName,
  siteGameUrl,
} from "../src/feeds.ts";
import { NFL_TEAMS } from "../src/nfl/teams.ts";

const BASE = "https://example.test/feeds/";
const byCode = new Map(NFL_TEAMS.map((team) => [team.abbreviation, team]));

function found(
  away: string,
  home: string,
  week: number,
  publishedAt: string,
  title = `${away} vs ${home} Game Highlights`,
  overrides: Partial<DatasetGame> = {},
): DatasetGame {
  return {
    season: 2026,
    season_type: "regular",
    week,
    away,
    home,
    external_ids: {},
    kickoff: "2026-10-11T17:00:00Z",
    status: "found",
    video: {
      youtube_id: `${away}${home}${week}`,
      title,
      published_at: publishedAt,
    },
    ...overrides,
  } as DatasetGame;
}

function build(games: DatasetGame[]): Map<string, string> {
  const file: SeasonFile = { season: 2026, games };
  return buildFeeds({
    league: "nfl",
    leagueName: "NFL",
    file,
    teams: NFL_TEAMS,
    baseUrl: BASE,
  });
}

function entryIds(feed: string): string[] {
  return [...feed.matchAll(/<entry>\s*<id>([^<]+)<\/id>/g)].map((m) => m[1]!);
}

describe("feeds", () => {
  it("writes one feed per team and one of every game", () => {
    const feeds = build([]);
    assert.equal(feeds.size, NFL_TEAMS.length + 1);
    assert.ok(feeds.has("nfl/all.atom"));
    assert.ok(feeds.has("nfl/kc.atom"));
    assert.ok(feeds.has("nfl/wsh.atom"));
  });

  it("lists a team's found games, home and away, newest first", () => {
    const feeds = build([
      found("KC", "BUF", 6, "2026-10-12T04:00:00Z"),
      found("DEN", "KC", 7, "2026-10-19T04:00:00Z"),
      found("DAL", "PHI", 7, "2026-10-19T05:00:00Z"),
      {
        ...found("KC", "LV", 8, "2026-10-26T04:00:00Z"),
        status: "searching",
      } as DatasetGame,
    ]);
    assert.deepEqual(entryIds(feeds.get("nfl/kc.atom")!), [
      "tag:quiet-football.com,2026:nfl/2026/regular/7/DEN@KC",
      "tag:quiet-football.com,2026:nfl/2026/regular/6/KC@BUF",
    ]);
    assert.equal(entryIds(feeds.get("nfl/all.atom")!).length, 3);
    assert.equal(entryIds(feeds.get("nfl/lv.atom")!).length, 0);
  });

  it("never shows YouTube's title, which can give the result away", () => {
    const feed = build([
      found("NE", "ATL", 22, "2017-02-06T04:00:00Z", "The 28-3 Comeback", {
        season_type: "postseason",
      }),
    ]).get("nfl/ne.atom")!;
    assert.ok(!feed.includes("28-3"));
    assert.match(
      feed,
      /<title>2026 Super Bowl: Patriots vs\. Falcons<\/title>/,
    );
  });

  it("names an entry by its game, so a correction moves its link in place", () => {
    const before = build([found("KC", "BUF", 6, "2026-10-12T04:00:00Z")]);
    const corrected = found("KC", "BUF", 6, "2026-10-12T04:30:00Z");
    if (corrected.status === "found") corrected.video.youtube_id = "other";
    const after = build([corrected]);
    const kcBefore = before.get("nfl/kc.atom")!;
    const kcAfter = after.get("nfl/kc.atom")!;
    assert.deepEqual(entryIds(kcBefore), entryIds(kcAfter));
    assert.match(kcAfter, /watch\?v=other/);
    assert.match(kcAfter, /<updated>2026-10-12T04:30:00Z<\/updated>/);
  });

  it("is a pure function of the data", () => {
    const games = [
      found("DAL", "PHI", 7, "2026-10-19T05:00:00Z"),
      found("KC", "BUF", 6, "2026-10-12T04:00:00Z"),
    ];
    assert.deepEqual(build(games), build([...games].reverse()));
  });

  it("dates an empty feed by the season's newest recap, or its first day", () => {
    const feeds = build([found("KC", "BUF", 6, "2026-10-12T04:00:00Z")]);
    assert.match(
      feeds.get("nfl/lv.atom")!,
      /<updated>2026-10-12T04:00:00Z<\/updated>/,
    );
    assert.match(
      build([]).get("nfl/all.atom")!,
      /<updated>2026-01-01T00:00:00Z<\/updated>/,
    );
  });

  it("escapes what it writes", () => {
    const feeds = buildFeeds({
      league: "nfl",
      leagueName: "NFL",
      file: { season: 2026, games: [] },
      teams: NFL_TEAMS,
      baseUrl: "https://example.test/?a=1&b=2/",
    });
    assert.match(feeds.get("nfl/kc.atom")!, /\?a=1&amp;b=2\/nfl\/kc\.atom/);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(feeds.get("nfl/kc.atom")!));
  });
});

describe("entryTitle", () => {
  const game = (
    seasonType: DatasetGame["season_type"],
    week: number,
    season = 2026,
  ) =>
    found("PIT", "HOU", week, "2026-01-01T00:00:00Z", "", {
      season,
      season_type: seasonType,
    });

  it("names the week as the league does", () => {
    assert.equal(
      entryTitle(game("regular", 9), byCode),
      "2026 Week 9: Steelers at Texans",
    );
    assert.equal(roundName(game("preseason", 1)), "Hall of Fame Game");
    assert.equal(roundName(game("preseason", 2)), "Preseason Week 1");
    assert.equal(roundName(game("postseason", 19)), "Wild Card");
    assert.equal(roundName(game("postseason", 20)), "Divisional");
    assert.equal(roundName(game("postseason", 21)), "Conference Championship");
    assert.equal(roundName(game("postseason", 22)), "Super Bowl");
  });

  it("counts the postseason from a 17-week regular season through 2020", () => {
    assert.equal(roundName(game("postseason", 18, 2019)), "Wild Card");
    assert.equal(roundName(game("postseason", 21, 2019)), "Super Bowl");
  });
});

describe("links to Quiet Football", () => {
  const at = (
    seasonType: DatasetGame["season_type"],
    week: number,
    season = 2026,
  ) =>
    siteGameUrl(
      found("MIN", "GB", week, "2026-01-01T00:00:00Z", "", {
        season,
        season_type: seasonType,
      }),
      byCode.get("MIN")!,
    );

  it("names the season and week, a playoff week by its round", () => {
    assert.equal(
      at("regular", 5),
      "https://quiet-football.com/team/MIN?season=2026&week=5",
    );
    assert.equal(
      at("postseason", 19),
      "https://quiet-football.com/team/MIN?season=2026&week=wild-card",
    );
    assert.equal(
      at("postseason", 21, 2019),
      "https://quiet-football.com/team/MIN?season=2019&week=super-bowl",
    );
  });

  it("links a preseason game to the team's season, which the site shows", () => {
    assert.equal(
      at("preseason", 3),
      "https://quiet-football.com/team/MIN?season=2026",
    );
  });

  it("opens the game from the feed's team, or the home team's in the league's", () => {
    const feeds = build([found("KC", "BUF", 6, "2026-10-12T04:00:00Z")]);
    const site = (feed: string) =>
      /<link rel="related"[^>]*href="([^"]+)"/.exec(feed)?.[1];
    assert.equal(
      site(feeds.get("nfl/kc.atom")!),
      "https://quiet-football.com/team/KC?season=2026&amp;week=6",
    );
    assert.equal(
      site(feeds.get("nfl/all.atom")!),
      "https://quiet-football.com/team/BUF?season=2026&amp;week=6",
    );
    assert.match(
      feeds.get("nfl/kc.atom")!,
      /<link rel="alternate" type="text\/html" href="https:\/\/quiet-football\.com\/team\/KC\?season=2026"\/>/,
    );
  });

  it("escapes the content's HTML for the XML around it", () => {
    const feed = build([found("KC", "BUF", 6, "2026-10-12T04:00:00Z")]).get(
      "nfl/kc.atom",
    )!;
    assert.match(
      feed,
      /<content type="html">&lt;p&gt;.*season=2026&amp;amp;week=6.*&lt;\/p&gt;<\/content>/,
    );
  });
});

describe("feedIndex", () => {
  it("links every feed and advertises the league's", () => {
    const page = feedIndex({
      league: "nfl",
      leagueName: "NFL",
      teams: NFL_TEAMS,
      baseUrl: BASE,
    });
    assert.match(
      page,
      /rel="alternate" type="application\/atom\+xml"[^>]*href="https:\/\/example\.test\/feeds\/nfl\/all\.atom"/,
    );
    for (const team of NFL_TEAMS) {
      assert.ok(
        page.includes(`href="nfl/${team.abbreviation.toLowerCase()}.atom"`),
      );
    }
  });
});
