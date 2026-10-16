# Football recaps

Every game's official recap video on YouTube, as one JSON file per league and
season. Today that is the NFL, from the NFL's own channel, under `nfl/`.
Kept current by [Quiet Football](https://github.com/dfrancour/quiet-football),
which finds each recap minutes after it is posted and commits it here.

**Status: publisher built, not yet deployed.** The files hold 2015 through
2026 to date, preseason included, backfilled from the NFL's uploads and its
weekly highlight playlists. The live publisher that keeps them current is
built and tested but not yet running on a server, so for now a new recap is
added by hand (below). Coverage is near-complete except
2021–2024, where the playlists skip games (most of all in the preseason).
Those gaps are `unknown`, not `missing`: a recap may well exist.

## Reading it

```
https://raw.githubusercontent.com/dfrancour/quiet-football-recap-data/main/nfl/2026.json
```

One request returns the whole season (about 110 KB when complete). Send
`If-None-Match` with the last `ETag`, and an unchanged file costs nothing.
GitHub caches the file for about five minutes after a commit.

## A season file

```json
{
  "schema_version": 1,
  "season": 2026,
  "games": [
    {
      "season": 2026,
      "season_type": "regular",
      "week": 5,
      "away": "BUF",
      "home": "LAR",
      "external_ids": { "espn": "401872994" },
      "kickoff": "2026-10-13T00:15:00Z",
      "status": "found",
      "video": {
        "youtube_id": "GP9zR_SKRr0",
        "title": "Buffalo Bills vs Los Angeles Rams Game Highlights | 2026 NFL Season Week 5",
        "published_at": "2026-10-13T04:10:35Z"
      }
    }
  ]
}
```

[`nfl/schema.json`](nfl/schema.json) is the full definition. A league
has its own schema, since its teams and weeks are its own.

### Which game

A game is named by **season, season type, week and its two teams**, never by
any source's id. A team plays once a week, so those and either team identify
one game.

- **Teams** are ESPN's abbreviations, one per team for every season (the
  Raiders are `LV` in 2019 too): `ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET
GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN
WSH`. For nflverse, `LAR` is `LA` and `WSH` is `WAS`.
- **Season types** are ESPN's: `preseason`, `regular`, `postseason`. Each
  numbers its own weeks.
- **Weeks** in the preseason and regular season are ESPN's.
  - The preseason starts with the Hall of Fame game alone in week 1, so **the
    NFL's "Preseason Week 1" is week 2 here**. Mind this when joining against
    the NFL's titles or other data.
  - The postseason is this dataset's own numbering, not ESPN's (which counts
    the postseason from 1 with the Pro Bowl as a week). It continues the
    regular season's count: in an 18-week season, Wild Card is 19,
    Divisional 20, Conference 21 and the Super Bowl 22, as nflverse numbers
    them.
- **Every game carries its season and season type**, so a record names its
  game on its own and seasons can be combined.
- **Games** are sorted by season type, then week, kickoff and home team.

### Other sources' ids

`external_ids` holds other sources' ids for the same game, by source. Today
that's ESPN's event id. These are references for joining and checking, not
the game's identity. If one ever disagrees with the season, season type,
week and teams, those win. ESPN's id still tells events apart where the key
alone can't: the 2017 Buccaneers–Dolphins game, postponed for Hurricane
Irma, is recorded with ESPN's week 11 event, not the postponed week 1 one.

### Which games are listed

A game appears once the publisher has seen it **final**. Whether a recap is
expected is up to the game's status, which this dataset does not repeat: a
game not yet played, postponed or canceled is simply absent.

| `status`    | Means                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `searching` | Final; no recap posted yet                                                                     |
| `found`     | `video` is the recap                                                                           |
| `missing`   | No recap within three days of kickoff                                                          |
| `unknown`   | No recap found, but nobody watched the three days after kickoff (a backfill), so one may exist |

A game final for more than about 15 minutes with no entry means the
publisher is behind.

### Times

All times are UTC, to the second.

- `kickoff`: the scheduled kickoff
- `final_seen_at`: when the publisher saw the game final. Absent if the game
  ended before the publisher was tracking it
- `video.published_at`: YouTube's publish time
- `detected_at`: when the publisher matched the video to the game. Absent
  for a backfilled match

### Spoilers

This is a record of facts, and some facts give results away: a title can
("The 28-3 Comeback"). Showing a recap without spoiling the game is the
reader's job. A record holds no score, description or thumbnail, but
`video.title` is YouTube's title, verbatim.

## History

Every change is its own commit, and the commit message says what happened:

```
track(nfl 2026 W6 DAL@PHI): final, searching
add(nfl 2026 W6 KC@BUF): abc123xyz_0 "Chiefs vs. Bills Game Highlights | …"
correct(nfl 2026 W6 KC@BUF): def456uvw_1 -> abc123xyz_0, reason=game-highlights
remove(nfl 2026 W6 KC@BUF): reason=wrong-match
miss(nfl 2026 W6 SF@SEA): window closed
untrack(nfl 2026 W6 NYJ@MIA): no longer final
```

Commits by the publisher are made by its own bot account; a correction made
by hand is made by a person, so the two can be told apart.

A preseason game reads `nfl 2026 PRE W3 CHI@TEN`, and a game in the regular
season or postseason reads `nfl 2026 W6 KC@BUF` (their weeks never overlap).
`git log --grep='nfl 2026 W6 KC@BUF'` is one game's history. The commits are also an
Atom feed: <https://github.com/dfrancour/quiet-football-recap-data/commits/main.atom>.

### As a database

[git-history](https://github.com/simonw/git-history) turns the history of a
file into SQLite, one row per version of each game:

```bash
git-history file recaps.db nfl/2026.json \
  --namespace game \
  --convert 'json.loads(content)["games"]' \
  --id season --id season_type --id week --id away --id home
```

`game` then holds each game's current record, and `game_version` every
change to it: when it was tracked, found, retitled or corrected.

## How it's made

The code that builds the dataset lives here with it, so a change to the
matching rules and the data it changes land together. Why the data is shaped
this way is in [docs/design.md](docs/design.md), when the publisher works in
[docs/scheduling.md](docs/scheduling.md), and what twelve seasons of recaps
taught in [docs/findings.md](docs/findings.md).

- `src/matcher.ts` decides which video is a game's recap: a title that says
  "highlights" or is only the matchup, never a preview, naming both teams,
  published within three days of kickoff. Publish time pins the game; a week
  in the title only breaks ties.
- `src/espn.ts` reads each season's schedule from ESPN's scoreboard, and
  numbers its weeks as described above.
- `src/youtube.ts` reads the channel's videos: its uploads, its playlists, a
  search within a time window, and a lookup by id. It counts the quota each
  call spends.
- `src/nfl/teams.ts` holds each team's codes, names and former names
  ("Redskins", "Oakland").
- `src/backfill.ts` builds a season after the fact from its schedule and the
  videos gathered for it. Nothing in it was watched live, so a game with no
  recap is `unknown`.
- `src/transitions.ts` is what the live publisher changes, given what it
  knows: track, add, correct, retitle, remove, miss and untrack, each one
  game's new record and its commit message.
- `src/planner.ts` decides when the publisher reads ESPN and YouTube, from
  the data and the quota left (docs/scheduling.md).
- `src/publisher.ts` runs a pass (pull, read what is due, commit each
  change, push) and the loop around it; `src/git.ts` is its checkout.
- `nfl/corrections.json` holds matches decided by a person: a recap whose
  title follows no rule, or a match the rules got wrong. The matcher never
  overrides one. Each names its game, the video (or `null` for none) and a
  reason.
- `test/` holds the titles the NFL has actually used, every quirk included.
  A new quirk belongs there.

Videos are gathered into `.cache/nfl-videos.json` (not in git), which also
remembers the searches already run so none is paid for twice. Gathering
needs a YouTube Data API key in `.env` (`YOUTUBE_API_KEY=…`). A backfill
rewrites a season from the cache alone, so a fresh checkout must gather the
whole season (`collect uploads --since` the preseason) before it adds a
game; a rewrite that would take a recap away from a game found before is
refused unless `--allow-loss` says so.

Until the publisher is deployed, a new recap is added by hand:

```bash
node --env-file=.env src/cli.ts collect uploads --since 2026-08-01T00:00:00Z
node src/cli.ts backfill 2026
npm run check && git diff
```

```bash
# the uploads list, back to a date (1 unit per 50 videos; it reaches back ~20,000 videos)
node --env-file=.env src/cli.ts collect uploads --since 2026-09-01T00:00:00Z
# every playlist whose title matches (1 unit per 50 videos)
node --env-file=.env src/cli.ts collect playlists --match "game highlights" --exclude "player"
# searches of the windows where games still have no recap (100 units each)
node --env-file=.env src/cli.ts collect gaps 2023 --types regular,postseason
node --env-file=.env src/cli.ts collect gaps 2023 --per-game
# specific videos, such as one a correction names
node --env-file=.env src/cli.ts collect ids GP9zR_SKRr0
```

Then rebuild seasons from ESPN's schedules, the gathered videos and the
corrections:

```bash
node src/cli.ts backfill 2015-2026
```

```bash
npm ci
npm test
```

## Checking

```bash
npm ci
npm run check
```

This validates every file against its schema (`scripts/validate.mjs`), then
checks what the schema can't (`scripts/check.mjs`, no dependencies):

- each file points at its schema, and its name and games match its season
- games are in order, and no team plays twice in a week
- no source's id names two games
- each file is in canonical form (2-space JSON, keys in schema order, a final
  newline)

A file is a pure function of what the publisher knows, so writing it again
without news changes no byte and makes no commit. Both cover `nfl/` only so
far, and CI runs them on every push.

## License

[CC0 1.0](LICENSE): the data, schema and scripts are dedicated to the public
domain, so use them for anything, without asking or crediting.

CC0 waives only rights this project holds. A video and its title belong to
whoever posted it, and this dataset only points to them.

## Running the publisher

`run` is the live publisher. It works in its own checkout, commits as its
own identity, and pushes after every pass, so try it on a scratch clone with
`--no-push` first:

```bash
node --env-file=.env src/cli.ts run --once --no-push --data /tmp/trial --clone "$PWD"
node src/cli.ts status --data /tmp/trial
```

On the server it runs in a container (`Dockerfile`, `compose.yaml`) with its
checkout and cache on a volume. Beside `compose.yaml` it needs `.env` with
`YOUTUBE_API_KEY` (and, optionally, `PUBLISHER_GIT_NAME` and
`PUBLISHER_GIT_EMAIL` for the bot identity), and `deploy_key`, the private
half of a deploy key with write access to this repository, readable by uid 1000. Then:

```bash
PUBLISHER_BUILD=$(git rev-parse --short=12 HEAD) docker compose up -d --build
docker compose logs -f publisher
```

The first start clones the repository onto the volume. `status --check` is
the container's health check: it fails when no pass has run in two hours or
the publisher is ten minutes past when it meant to wake.
