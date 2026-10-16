import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RECAP_WINDOW_MS,
  decodeHtmlEntities,
  isRecapFor,
  matchRecap,
  namesTeam,
  type Game,
  type Team,
  type Video,
} from "../src/matcher.ts";
import { NFL_TEAMS, nflTeam } from "../src/nfl/teams.ts";

const HOUR = 3_600_000;

function game(week: number, kickoff: string, away: string, home: string): Game {
  return { week, kickoff, away: nflTeam(away), home: nflTeam(home) };
}

function hoursAfter(kickoff: string, hours: number): string {
  return new Date(Date.parse(kickoff) + hours * HOUR).toISOString();
}

function video(
  title: string,
  publishedAt: string,
  youtubeId = "abcDEF12_-3",
): Video {
  return { youtubeId, title, publishedAt };
}

/** Week 4: MIA at MIN. */
const week4 = game(4, "2026-10-04T17:00:00.000Z", "MIA", "MIN");

/** Recaps land 3–8 hours after kickoff; four sits inside that. */
function accepts(title: string, at = week4, publishedAt?: string): boolean {
  return isRecapFor(
    video(title, publishedAt ?? hoursAfter(at.kickoff, 4)),
    at,
    NFL_TEAMS,
  );
}

const names = (title: string, abbreviation: string) =>
  namesTeam(title, nflTeam(abbreviation), NFL_TEAMS);

describe("decodeHtmlEntities", () => {
  it("decodes the entities YouTube escapes in titles", () => {
    assert.equal(
      decodeHtmlEntities("Giants&#39; best plays"),
      "Giants' best plays",
    );
    assert.equal(decodeHtmlEntities("&quot;Wow&quot;"), '"Wow"');
    assert.equal(decodeHtmlEntities("Rams &amp; 49ers"), "Rams & 49ers");
  });
});

describe("namesTeam", () => {
  it("accepts the nickname", () => {
    assert.equal(names("Saints vs Vikings", "NO"), true);
  });

  it("accepts the location when the nickname is misspelled", () => {
    assert.equal(names("New Orleans Saint", "NO"), true);
  });

  it("ignores a location two teams share", () => {
    assert.equal(names("New York Football", "NYG"), false);
    assert.equal(names("New York Football", "NYJ"), false);
  });

  it("matches whole words only", () => {
    assert.equal(names("Jetsons marathon", "NYJ"), false);
  });

  it("accepts the nickname in the singular", () => {
    assert.equal(names("New York Giant", "NYG"), true);
    assert.equal(names("New York Giant", "NYJ"), false);
  });

  it("accepts a former name", () => {
    assert.equal(names("Redskins vs. Cowboys", "WSH"), true);
    assert.equal(names("Oakland vs. Denver", "LV"), true);
  });
});

describe("isRecapFor", () => {
  it("accepts the season-first title shape", () => {
    assert.equal(
      accepts(
        "Miami Dolphins vs Minnesota Vikings Game Highlights | 2026 NFL Season Week 4",
      ),
      true,
    );
  });

  it("accepts the NFL-first title shape", () => {
    assert.equal(
      accepts(
        "Miami Dolphins vs. Minnesota Vikings Game Highlights | NFL 2026 Season Week 4",
      ),
      true,
    );
  });

  it("accepts a misspelled nickname", () => {
    assert.equal(
      accepts(
        "Minnesota Vikings vs New Orleans Saint Game Highlights | NFL 2026 Season Week 5",
        game(5, "2026-10-11T17:00:00.000Z", "MIN", "NO"),
      ),
      true,
    );
  });

  it("accepts a title with no season year", () => {
    assert.equal(
      accepts(
        "Pittsburgh Steelers vs. New England Patriots Game Highlights | NFL Week 2",
        game(2, "2026-09-20T17:00:00.000Z", "PIT", "NE"),
      ),
      true,
    );
  });

  it("accepts a title with no season or week", () => {
    assert.equal(
      accepts(
        "Cleveland Browns vs Tampa Bay Buccaneers Game Highlights",
        game(2, "2026-09-20T17:00:00.000Z", "CLE", "TB"),
      ),
      true,
    );
  });

  it("accepts a title whose week is wrong, since the date pins the game", () => {
    assert.equal(
      accepts(
        "Miami Dolphins vs Minnesota Vikings Game Highlights | 2026 NFL Season Week 3",
      ),
      true,
    );
    assert.equal(
      accepts(
        "Miami Dolphins vs. Minnesota Vikings | Week 2026 Game Highlights",
      ),
      true,
    );
  });

  it("accepts a title that is only the matchup", () => {
    assert.equal(
      accepts("Miami Dolphins vs Minnesota Vikings | 2026 Preseason Week 3"),
      true,
    );
    assert.equal(accepts("Dolphins at Vikings | NFL 2026"), true);
  });

  it("rejects a reel that names both teams without saying highlights", () => {
    assert.equal(
      accepts(
        "Jordan Fielder's best catches from a 112-yard game vs. Miami Dolphins | Minnesota Vikings",
      ),
      false,
    );
  });

  it("rejects a preview", () => {
    assert.equal(
      accepts(
        "Miami Dolphins vs. Minnesota Vikings | NFL 2026 Wild Card Weekend Preview",
      ),
      false,
    );
  });

  it("leaves a preseason meeting's recap to the preseason game", () => {
    assert.equal(
      accepts(
        "Miami Dolphins vs. Minnesota Vikings Game Highlights | 2026 Preseason Week 3",
        week4,
        "2026-08-23T03:00:00.000Z",
      ),
      false,
    );
  });

  it("rejects the same matchup published outside the window", () => {
    const title = "Miami Dolphins vs Minnesota Vikings Game Highlights";
    const tooLate = new Date(
      Date.parse(week4.kickoff) + RECAP_WINDOW_MS + 1,
    ).toISOString();

    assert.equal(accepts(title, week4, "2025-10-04T21:00:00.000Z"), false);
    assert.equal(accepts(title, week4, tooLate), false);
    assert.equal(accepts(title, week4, "2026-10-04T16:00:00.000Z"), false);
  });

  it("rejects a video naming only one of the two teams", () => {
    assert.equal(
      accepts("Minnesota Vikings Game Highlights | 2026 NFL Season Week 4"),
      false,
    );
  });

  it("rejects a different game in the same week", () => {
    assert.equal(
      accepts(
        "Green Bay Packers vs Chicago Bears Game Highlights | 2026 NFL Season Week 4",
      ),
      false,
    );
  });

  it("needs the nickname when two teams share a location", () => {
    const nygAtWsh = game(4, "2026-10-04T17:00:00.000Z", "NYG", "WSH");
    assert.equal(
      accepts(
        "New York Jets vs Washington Commanders Game Highlights",
        nygAtWsh,
      ),
      false,
    );
    assert.equal(
      accepts(
        "New York Giants vs Washington Commanders Game Highlights",
        nygAtWsh,
      ),
      true,
    );
  });

  it("rejects clips that are not a highlights reel", () => {
    assert.equal(
      accepts(
        "Every Vikings touchdown vs the Dolphins | 2026 NFL Season Week 4",
      ),
      false,
    );
  });

  it("does not care which side the title names first", () => {
    assert.equal(
      accepts("Minnesota Vikings vs Miami Dolphins Game Highlights"),
      true,
    );
  });
});

describe("matchRecap", () => {
  const title = "Miami Dolphins vs Minnesota Vikings Game Highlights";
  const pick = (videos: Video[]) =>
    matchRecap(videos, week4, NFL_TEAMS)?.youtubeId ?? null;

  it("returns the video that satisfies every constraint", () => {
    assert.equal(
      pick([
        video(
          "Random Vikings clip",
          hoursAfter(week4.kickoff, 4),
          "aaaaaaaaaaa",
        ),
        video(title, hoursAfter(week4.kickoff, 4), "YHo13wCIHT4"),
      ]),
      "YHo13wCIHT4",
    );
  });

  it("prefers the game's recap to a later player reel naming both teams", () => {
    assert.equal(
      pick([
        video(
          "Jordan Fielder's Best Plays vs. Dolphins | Vikings Highlights",
          hoursAfter(week4.kickoff, 9),
          "reel0000000",
        ),
        video(title, hoursAfter(week4.kickoff, 4), "YHo13wCIHT4"),
      ]),
      "YHo13wCIHT4",
    );
  });

  it("takes the earliest of two that both read as the game's", () => {
    assert.equal(
      pick([
        video(
          `${title} (Extended)`,
          hoursAfter(week4.kickoff, 20),
          "extended000",
        ),
        video(title, hoursAfter(week4.kickoff, 4), "YHo13wCIHT4"),
      ]),
      "YHo13wCIHT4",
    );
  });

  it("prefers a title whose week agrees with the game's", () => {
    assert.equal(
      pick([
        video(`${title} | Week 4`, hoursAfter(week4.kickoff, 5), "agrees00000"),
        video(`${title} | Week 3`, hoursAfter(week4.kickoff, 4), "contradicts"),
      ]),
      "agrees00000",
    );
  });

  it("prefers the game's highlights to a condensed game titled by its matchup", () => {
    assert.equal(
      pick([
        video(
          "Dolphins vs. Vikings | Week 4 NFL Game Pass Condensed Game of the Week",
          hoursAfter(week4.kickoff, 4),
          "condensed00",
        ),
        video(
          "Dolphins vs. Vikings Week 4 Highlights | NFL 2026",
          hoursAfter(week4.kickoff, 5),
          "YHo13wCIHT4",
        ),
      ]),
      "YHo13wCIHT4",
    );
  });

  it("returns null when nothing matches", () => {
    assert.equal(
      pick([video("Unrelated", hoursAfter(week4.kickoff, 4))]),
      null,
    );
  });
});

/**
 * Titles with every kind of drift seen in the NFL's: no year, no "Season", no
 * suffix, the week before the bar, a venue, a misspelling, a singular
 * nickname, a wrong week, the year where the week goes, a shared location,
 * and highlight videos that are not recaps. A new quirk belongs here.
 */
describe("a season of titles", () => {
  const WEEK_1 = "2026-09-13T17:00:00.000Z";
  const WEEK_2 = "2026-09-20T17:00:00.000Z";
  const THURSDAY = "2026-09-11T00:00:00.000Z";

  const games = [
    game(1, THURSDAY, "DET", "GB"),
    game(1, WEEK_1, "MIN", "CHI"),
    game(1, WEEK_1, "NE", "NYJ"),
    game(1, WEEK_1, "NYG", "WSH"),
    game(1, WEEK_1, "TB", "NO"),
    // The same two teams again a week on: only the date tells them apart.
    game(2, WEEK_2, "CHI", "MIN"),
    game(2, WEEK_2, "MIA", "NYJ"),
    game(2, WEEK_2, "PIT", "CLE"),
    game(2, WEEK_2, "WSH", "NYG"),
    // A week-1 rematch whose recap says "Week 1": the date decides.
    game(2, WEEK_2, "DET", "GB"),
    game(2, WEEK_2, "NE", "TB"),
  ];

  let id = 0;
  const posted = (title: string, kickoff: string, hours = 4) => {
    id += 1;
    return video(
      title,
      hoursAfter(kickoff, hours),
      `video${String(id).padStart(6, "0")}`,
    );
  };

  const videos: Video[] = [
    posted(
      "Detroit Lions vs Green Bay Packers Game Highlights | 2026 Week 1 Melbourne Game",
      THURSDAY,
      3,
    ),
    posted(
      "Minnesota Vikings vs. Chicago Bears Game Highlights | NFL 2026 Season Week 1",
      WEEK_1,
    ),
    posted(
      "New England Patriots vs. New York Jets Game Highlights | 2026 NFL Week 1",
      WEEK_1,
      5,
    ),
    posted(
      "New York Giants vs Washington Commanders Game Highlights Week 1 | NFL 2026",
      WEEK_1,
      6,
    ),
    posted(
      "Tampa Bay Buccaneers vs New Orleans Saint Game Highlights",
      WEEK_1,
      7,
    ),
    posted(
      "Chicago Bears vs. Minnesota Vikings Game Highlights | NFL Week 2",
      WEEK_2,
    ),
    posted(
      "Miami Dolphins vs. New York Jets Game Highlights | NFL 2026 Week 2",
      WEEK_2,
      3,
    ),
    posted(
      "Pittsburgh Steelers vs Cleveland Browns Game Highlights | 2026 NFL Season Week 2",
      WEEK_2,
      5,
    ),
    posted(
      "Washington Commanders vs New York Giant Game Highlights | 2026 NFL Season Week 2",
      WEEK_2,
    ),
    posted(
      "Detroit Lions vs. Green Bay Packers Game Highlights | NFL 2026 Season Week 1",
      WEEK_2,
    ),
    posted(
      "New England Patriots vs. Tampa Bay Buccaneers | Week 2026 Game Highlights",
      WEEK_2,
    ),
    posted(
      "Every Single Game Highlight from Sunday Afternoon | NFL 2026 Season Week 2",
      WEEK_2,
      5,
    ),
    posted("2026 Rookies BEST Preseason Highlights!", WEEK_1, -200),
    posted(
      "Jordan Fielder's Best Catches vs. the Bears | Highlights",
      WEEK_2,
      6,
    ),
    posted("Jalen Sprint Highlights vs New York Jets | Week 2", WEEK_2, 6),
  ];

  const recapsFor = (entry: Game) =>
    videos.filter((v) => isRecapFor(v, entry, NFL_TEAMS));
  const label = (entry: Game) =>
    `W${entry.week} ${entry.away.abbreviation}@${entry.home.abbreviation}`;

  for (const entry of games) {
    it(`finds exactly one recap for ${label(entry)}`, () => {
      assert.equal(recapsFor(entry).length, 1);
    });
  }

  it("tells a rematch apart by date", () => {
    assert.match(recapsFor(games[1]!)[0]!.title, /Week 1/);
    assert.match(recapsFor(games[5]!)[0]!.title, /Week 2/);
  });

  it("places every game-highlights title on a game", () => {
    const placed = new Set(
      games.flatMap((entry) => recapsFor(entry).map((v) => v.youtubeId)),
    );
    const orphans = videos
      .filter((v) => /game highlights/i.test(v.title))
      .filter((v) => !placed.has(v.youtubeId))
      .map((v) => v.title);
    assert.deepEqual(orphans, []);
  });

  it("places nothing that is not one game's recap", () => {
    const placed = new Set(
      games.flatMap((entry) => recapsFor(entry).map((v) => v.title)),
    );
    assert.equal(placed.size, games.length);
    for (const title of placed) assert.match(title, /game highlights/i);
  });
});
