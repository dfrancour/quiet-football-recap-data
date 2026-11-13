/**
 * Atom feeds of the season's recaps: one per team, and one of every game.
 *
 * A feed is a reader of the dataset, so hiding spoilers is its job. An
 * entry's title is written from the record ("2026 Week 9: Bills at Vikings"),
 * never YouTube's, which can give the result away and which the NFL often
 * changes after posting. An entry is a game, not a video: its id names the
 * game, so a correction moves its link and a removal drops it, and a
 * retitle changes nothing.
 *
 * An entry links to the recap on YouTube, and to the game on Quiet Football,
 * which shows it without the result. A link to the site names the season
 * (`/team/MIN?season=2026&week=5`), so it still names the same game once the
 * site has moved on to a later season.
 *
 * Like a season file, a feed is a pure function of the data: built again
 * without news, it changes no byte.
 */

import type { DatasetGame, DatasetVideo, SeasonFile } from "../dataset.ts";
import { compareGames } from "../dataset.ts";
import type { League, Team } from "../model.ts";

export interface FeedOptions {
  league: League;
  /** The current season's file; a feed covers that season alone. */
  file: SeasonFile;
  /** Where the site is served, with a final slash. */
  baseUrl: string;
}

type FoundGame = DatasetGame & { status: "found"; video: DatasetVideo };

/** A feed id's authority, fixed for good: a feed's id must never change. */
const TAG = "tag:quiet-football.com,2026";

export const SITE = "https://quiet-football.com";

/** The site's names for the postseason weeks, as its URLs give them. */
const SITE_ROUNDS = ["wild-card", "divisional", "conference", "super-bowl"];

/** Each feed's path and contents: `nfl/all.atom`, `nfl/kc.atom`, … */
export function buildFeeds(options: FeedOptions): Map<string, string> {
  const { id: league, teams } = options.league;
  const found = options.file.games
    .filter((game): game is FoundGame => game.status === "found")
    .sort(newestFirst);
  const byCode = new Map(teams.map((team) => [team.abbreviation, team]));
  const feeds = new Map<string, string>();
  feeds.set(
    `${league}/all.atom`,
    feed(options, null, found, byCode, newest(found)),
  );
  for (const team of teams) {
    const games = found.filter(
      (game) =>
        game.away === team.abbreviation || game.home === team.abbreviation,
    );
    feeds.set(
      feedPath(league, team),
      feed(options, team, games, byCode, newest(games) ?? newest(found)),
    );
  }
  return feeds;
}

export function feedPath(league: string, team: Team): string {
  return `${league}/${team.abbreviation.toLowerCase()}.atom`;
}

/**
 * How an entry names its game, without the result: "2026 Week 9: Bills
 * at Vikings", "2025 Wild Card: Steelers at Texans", "2025 Super Bowl:
 * Patriots vs. Seahawks". The year is the season's, as in the dataset, so a
 * season's postseason, played the next January and February, keeps it.
 */
export function entryTitle(
  game: DatasetGame,
  teams: ReadonlyMap<string, Team>,
): string {
  return `${game.season} ${roundName(game)}: ${matchup(game, teams, (team) => team.nickname)}`;
}

/** "Bills at Vikings"; the Super Bowl, at a neutral site, is "vs.". */
function matchup(
  game: DatasetGame,
  teams: ReadonlyMap<string, Team>,
  name: (team: Team) => string,
): string {
  const between = roundName(game) === "Super Bowl" ? "vs." : "at";
  return `${name(team(game.away, teams))} ${between} ${name(team(game.home, teams))}`;
}

/**
 * The week as the league says it. The preseason opens with the Hall of Fame
 * game alone in week 1, so the NFL's "Preseason Week 1" is week 2 here; the
 * postseason continues the regular season's count.
 */
export function roundName(game: DatasetGame): string {
  if (game.season_type === "preseason") {
    return game.week === 1
      ? "Hall of Fame Game"
      : `Preseason Week ${game.week - 1}`;
  }
  if (game.season_type === "regular") return `Week ${game.week}`;
  const rounds = [
    "Wild Card",
    "Divisional",
    "Conference Championship",
    "Super Bowl",
  ];
  return rounds[postseasonRound(game)] ?? `Postseason Week ${game.week}`;
}

/** 0 for the Wild Card round, through 3 for the Super Bowl. */
function postseasonRound(game: DatasetGame): number {
  const regularWeeks = game.season <= 2020 ? 17 : 18;
  return game.week - regularWeeks - 1;
}

/**
 * A team's season on Quiet Football, or the league's: `/team/MIN?season=2026`,
 * `/?season=2026`.
 */
export function siteSeasonUrl(season: number, team: Team | null): string {
  const path = team ? `/team/${team.abbreviation}` : "/";
  return `${SITE}${path}?season=${season}`;
}

/**
 * The game on Quiet Football, from one team's page: `/team/MIN?season=2026&week=5`,
 * `&week=wild-card` in the postseason. The site shows no preseason, so a
 * preseason game links to the team's season.
 */
export function siteGameUrl(game: DatasetGame, team: Team): string {
  const season = siteSeasonUrl(game.season, team);
  if (game.season_type === "regular") return `${season}&week=${game.week}`;
  const round =
    game.season_type === "postseason"
      ? SITE_ROUNDS[postseasonRound(game)]
      : undefined;
  return round ? `${season}&week=${round}` : season;
}

function feed(
  options: FeedOptions,
  team: Team | null,
  games: readonly FoundGame[],
  teams: ReadonlyMap<string, Team>,
  updated: string | undefined,
): string {
  const { id: league, name: leagueName } = options.league;
  const { baseUrl } = options;
  const season = options.file.season;
  const path = team ? feedPath(league, team) : `${league}/all.atom`;
  const title = team ? `${fullName(team)} recaps` : `${leagueName} recaps`;
  const subtitle = team
    ? `Each ${fullName(team)} game's recap video from YouTube, ${season} season.`
    : `Each ${leagueName} game's recap video from YouTube, ${season} season.`;
  const lines = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom">`,
    `  <id>${TAG}:${path.replace(/\.atom$/, "")}</id>`,
    `  <title>${escape(title)}</title>`,
    `  <subtitle>${escape(subtitle)}</subtitle>`,
    // With no recap yet this season, the season's first day stands in.
    `  <updated>${updated ?? `${season}-01-01T00:00:00Z`}</updated>`,
    `  <link rel="self" type="application/atom+xml" href="${escape(baseUrl + path)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escape(siteSeasonUrl(season, team))}"/>`,
    `  <icon>${escape(`${baseUrl}apple-icon.png`)}</icon>`,
    `  <author><name>Quiet Football</name></author>`,
    ...games.flatMap((game) => entry(league, game, teams, team)),
    `</feed>`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * One game's entry. Its link to the site opens the game from the feed's team,
 * or in the league's feed from the home team.
 */
function entry(
  league: string,
  game: FoundGame,
  teams: ReadonlyMap<string, Team>,
  feedTeam: Team | null,
): string[] {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(game.video.youtube_id)}`;
  const site = siteGameUrl(game, feedTeam ?? team(game.home, teams));
  const description = `${game.season} ${roundName(game)}: ${matchup(game, teams, fullName)}.`;
  const content =
    `<p>${escape(description)}</p>` +
    `<p><a href="${escape(url)}">Watch the recap on YouTube</a> · ` +
    `<a href="${escape(site)}">Open the game on Quiet Football</a></p>`;
  return [
    `  <entry>`,
    `    <id>${TAG}:${league}/${game.season}/${game.season_type}/${game.week}/${game.away}@${game.home}</id>`,
    `    <title>${escape(entryTitle(game, teams))}</title>`,
    `    <updated>${game.video.published_at}</updated>`,
    `    <published>${game.video.published_at}</published>`,
    `    <link rel="alternate" type="text/html" href="${escape(url)}"/>`,
    `    <link rel="related" type="text/html" title="Quiet Football" href="${escape(site)}"/>`,
    `    <summary>${escape(description)}</summary>`,
    // HTML, escaped once for itself and once more for the XML around it.
    `    <content type="html">${escape(content)}</content>`,
    `  </entry>`,
  ];
}

/** Newest recap first; a tie goes in the dataset's own order. */
function newestFirst(a: FoundGame, b: FoundGame): number {
  return (
    b.video.published_at.localeCompare(a.video.published_at) ||
    compareGames(a, b)
  );
}

function newest(games: readonly FoundGame[]): string | undefined {
  return games[0]?.video.published_at;
}

function team(code: string, teams: ReadonlyMap<string, Team>): Team {
  const found = teams.get(code);
  if (!found) throw new Error(`No team ${code}`);
  return found;
}

export function fullName(team: Team): string {
  return `${team.location} ${team.nickname}`;
}

/** Text escaped for XML or HTML, in content or an attribute. */
export function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
