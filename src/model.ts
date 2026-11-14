/**
 * What every part of the dataset speaks in: leagues and their teams, games
 * as a schedule gives them, and videos as a channel posts them. It depends on
 * nothing, and everything else depends on it.
 */

export interface Team {
  /** ESPN's abbreviation, the dataset's team code. */
  abbreviation: string;
  /** ESPN's team id, for reading ESPN's schedules. */
  espnId: string;
  location: string;
  nickname: string;
  /** Its two colors, as `#rrggbb`: the main one, then the alternate. */
  colors: readonly [string, string];
  /** Names older titles use on their own: "Redskins", "Oakland". */
  formerNames: readonly string[];
}

/** A conference's divisions as they stand today, each by its team codes. */
export interface Conference {
  name: string;
  divisions: readonly { name: string; teams: readonly string[] }[];
}

/** Everything the code knows about a league that is the league's own. */
export interface League {
  /** Its folder in the dataset and its name in commit messages: "nfl". */
  id: string;
  /** Its name as a reader knows it: "NFL". */
  name: string;
  /** One per franchise for every season. */
  teams: readonly Team[];
  /** Only the feeds' index and OPML files use it; a record never does. */
  conferences: readonly Conference[];
  /** The YouTube channel that posts every game's recap. */
  channelId: string;
  espn: {
    /**
     * The league's scoreboard on ESPN's site API. Asked for no date, it is
     * the current week's, upcoming games included.
     */
    scoreboard: string;
    /** Where ESPN keeps the league's team marks, dark variant. */
    logos: string;
  };
}

export type SeasonType = "preseason" | "regular" | "postseason";

/** Season types in the order a season plays them, and a file sorts them. */
export const SEASON_TYPES: readonly SeasonType[] = [
  "preseason",
  "regular",
  "postseason",
];

export type GameStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "canceled";

export interface Game {
  /** The week within the game's season type. */
  week: number;
  kickoff: string;
  home: Team;
  away: Team;
}

/** A game as a season's schedule gives it. */
export interface ScheduledGame extends Game {
  seasonType: SeasonType;
  status: GameStatus;
  /** ESPN's event id, kept as a reference in `external_ids`. */
  espnId: string;
}

/** A game read from a day's scoreboard, which can span seasons. */
export interface LiveGame extends ScheduledGame {
  season: number;
}

export interface Video {
  youtubeId: string;
  title: string;
  publishedAt: string;
}
