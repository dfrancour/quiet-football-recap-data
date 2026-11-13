import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatasetGame, SeasonFile } from "../../src/dataset.ts";
import {
  buildFeeds,
  entryTitle,
  roundName,
  siteGameUrl,
} from "../../src/feeds/atom.ts";
import { NFL } from "../../src/leagues/nfl.ts";

const BASE = "https://example.test/feeds/";
const byCode = new Map(NFL.teams.map((team) => [team.abbreviation, team]));

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
    league: NFL,
    file,
    baseUrl: BASE,
  });
}

function entryIds(feed: string): string[] {
  return [...feed.matchAll(/<entry>\s*<id>([^<]+)<\/id>/g)].map((m) => m[1]!);
}

describe("feeds", () => {
  it("writes one feed per team and one of every game", () => {
    const feeds = build([]);
    assert.equal(feeds.size, NFL.teams.length + 1);
    assert.ok(feeds.has("nfl/all.atom"));
    assert.ok(feeds.has("nfl/kc.atom"));
    assert.ok(feeds.has("nfl/wsh.atom"));
  });

  it("names a feed for a reader's list, the team first, then the site", () => {
    const feeds = build([]);
    const kc = feeds.get("nfl/kc.atom")!;
    assert.match(kc, /<title>Chiefs recaps · Quiet Football<\/title>/);
    assert.match(
      kc,
      /<subtitle>Every Kansas City Chiefs game&apos;s recap video, minutes after it is posted\. Spoiler-free: no scores, no YouTube titles, no thumbnails\.<\/subtitle>/,
    );
    assert.match(
      kc,
      /<author><name>Quiet Football<\/name><uri>https:\/\/quiet-football\.com\/<\/uri><\/author>/,
    );
    assert.match(
      feeds.get("nfl/all.atom")!,
      /<title>NFL recaps · Quiet Football<\/title>\s*<subtitle>Every NFL game&apos;s/,
    );
  });

  it("files an entry under its two teams and its part of the season", () => {
    const feed = build([
      found("BUF", "MIN", 9, "2026-11-10T04:00:00Z"),
      found("CHI", "TEN", 3, "2026-08-20T04:00:00Z", "", {
        season_type: "preseason",
      }),
    ]).get("nfl/all.atom")!;
    const categories = [...feed.matchAll(/<category term="([^"]+)"\/>/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(categories, [
      "Buffalo Bills",
      "Minnesota Vikings",
      "Regular season",
      "Chicago Bears",
      "Tennessee Titans",
      "Preseason",
    ]);
  });

  it("names the WebSub hub beside its own address", () => {
    const kc = build([]).get("nfl/kc.atom")!;
    assert.match(
      kc,
      /<link rel="self" type="application\/atom\+xml" href="https:\/\/example\.test\/feeds\/nfl\/kc\.atom"\/>\s*<link rel="hub" href="https:\/\/pubsubhubbub\.appspot\.com\/"\/>/,
    );
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
    assert.match(feed, /<title>Patriots vs\. Falcons · Super Bowl<\/title>/);
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
      league: NFL,
      file: { season: 2026, games: [] },
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
      "Steelers at Texans · Week 9",
    );
    assert.equal(
      entryTitle(game("postseason", 19), byCode),
      "Steelers at Texans · Wild Card",
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
