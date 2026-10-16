/**
 * Decides which of a channel's videos is a game's recap. Titles are
 * hand-typed and inconsistent, so a game is pinned by publish time and the
 * title only has to name both teams and look like a recap.
 */

export interface Team {
  /** ESPN's abbreviation, the dataset's team code. */
  abbreviation: string;
  /** ESPN's team id, for reading ESPN's schedules. */
  espnId: string;
  location: string;
  nickname: string;
  /** Names older titles use on their own: "Redskins", "Oakland". */
  formerNames: readonly string[];
}

export interface Game {
  /** The week within the game's season type. */
  week: number;
  kickoff: string;
  home: Team;
  away: Team;
}

export interface Video {
  youtubeId: string;
  title: string;
  publishedAt: string;
}

/**
 * How long after kickoff a recap may be published. Recaps land 3–8 hours
 * after kickoff, older ones up to two days; two teams never meet twice
 * inside it, so it pins the game.
 */
export const RECAP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** YouTube returns snippet titles HTML-escaped. */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function containsWord(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * By nickname, singular or plural, or location, since the NFL misspells
 * either ("New Orleans Saint", "Los Vegas Raiders", "New York Giant"), or by
 * a former name. A location two teams share names neither.
 */
export function namesTeam(
  title: string,
  team: Team,
  teams: readonly Team[],
): boolean {
  const singular = team.nickname.replace(/s$/, "");
  if (containsWord(title, team.nickname) || containsWord(title, singular)) {
    return true;
  }
  if (team.formerNames.some((name) => containsWord(title, name))) return true;

  const sharesLocation = teams.some(
    (other) =>
      other.abbreviation !== team.abbreviation &&
      other.location === team.location,
  );
  return !sharesLocation && containsWord(title, team.location);
}

/** A title that is just the matchup before its first bar: "Bears vs Titans | …". */
function isBareMatchup(title: string, game: Game): boolean {
  const head = title.split("|")[0]!.trim().toLowerCase();
  const sides = head.split(/\s+(?:vs\.?|at|@)\s+/);
  if (sides.length !== 2) return false;
  const names = (team: Team) =>
    [`${team.location} ${team.nickname}`, team.nickname, team.location].map(
      (name) => name.toLowerCase(),
    );
  const [first, second] = sides as [string, string];
  return (
    (names(game.away).includes(first) && names(game.home).includes(second)) ||
    (names(game.home).includes(first) && names(game.away).includes(second))
  );
}

/**
 * A recap says "highlights" or is titled by its matchup alone, is never a
 * preview, names both teams, and is published within `RECAP_WINDOW_MS` of
 * kickoff. Titles often lack the season or week, or get the week wrong, so a
 * week in the title only breaks ties (`matchRecap`).
 */
export function isRecapFor(
  video: Video,
  game: Game,
  teams: readonly Team[],
): boolean {
  const title = video.title.toLowerCase();

  const recapShaped =
    title.includes("highlight") || isBareMatchup(video.title, game);
  if (!recapShaped || title.includes("preview")) return false;
  if (!namesTeam(title, game.home, teams)) return false;
  if (!namesTeam(title, game.away, teams)) return false;

  const sinceKickoff = Date.parse(video.publishedAt) - Date.parse(game.kickoff);
  return sinceKickoff >= 0 && sinceKickoff <= RECAP_WINDOW_MS;
}

/** 0 for the game's highlights, 1 for other highlights, 2 for a bare matchup. */
function recapTier(title: string, game: Game): number {
  if (!/highlight/i.test(title)) return 2;
  return /game highlight/i.test(title) || isBareMatchup(title, game) ? 0 : 1;
}

/** Whether the title names a week other than the game's ("Week 2022" does). */
function contradictsWeek(video: Video, game: Game): boolean {
  const week = /week\s+(\d+)/i.exec(video.title);
  return Boolean(week?.[1]) && Number(week?.[1]) !== game.week;
}

/**
 * A player's reel or a condensed game can also fit, so the first fit is not
 * enough. Highlights of the game itself win (saying "game highlights", or
 * the matchup alone and "highlights"), then other highlights, then a title
 * that is only the matchup. Within a tier, a title whose week does not
 * contradict the game's wins, then the earliest published.
 */
export function matchRecap(
  videos: readonly Video[],
  game: Game,
  teams: readonly Team[],
): Video | null {
  const rank = (video: Video): [number, number] => [
    recapTier(video.title, game) * 2 + (contradictsWeek(video, game) ? 1 : 0),
    Date.parse(video.publishedAt),
  ];
  let best: Video | null = null;
  for (const video of videos) {
    if (!isRecapFor(video, game, teams)) continue;
    if (best === null) {
      best = video;
      continue;
    }
    const [tier, at] = rank(video);
    const [bestTier, bestAt] = rank(best);
    if (tier < bestTier || (tier === bestTier && at < bestAt)) best = video;
  }
  return best;
}
