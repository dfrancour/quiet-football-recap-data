# Football recaps

Every game's official recap video on YouTube, as one JSON file per league and
season. Today that is the NFL, from the NFL's own channel, under `nfl/`.
Kept current by [Quiet Football](https://github.com/dfrancour/quiet-football),
which finds each recap minutes after it is posted and commits it here.

**Status: live.** The publisher has kept the files current since week 6 of
2026 (October 18, 2026), committing each game as it goes final and its recap
minutes after it is posted. Earlier games, back to 2015 and preseason
included, were backfilled from the NFL's uploads and its weekly highlight
playlists. Coverage is near-complete except 2021–2024, where the playlists
skip games (most of all in the preseason). Those gaps are `unknown`, not
`missing`: a recap may well exist.

## Reading it

```
https://raw.githubusercontent.com/dfrancour/quiet-football-recap-data/main/nfl/2026.json
```

One request returns the whole season (about 110 KB when complete). Send
`If-None-Match` with the last `ETag`, and an unchanged file costs nothing.
GitHub caches the file for about five minutes after a commit.

### As a feed

Each team's recaps are an Atom feed, one entry per game, newest first:

```
https://feeds.quiet-football.com/nfl/kc.atom
https://feeds.quiet-football.com/nfl/all.atom
```

A feed covers the current season. An entry's title names the game, never
the result ("Bills at Vikings · Week 9"), and links to the video on YouTube
and to the game on [Quiet Football](https://quiet-football.com). Its
categories are its two teams and its part of the season ("Buffalo Bills",
"Minnesota Vikings", "Regular season"), for a reader's filters.
Its id names the game, so a corrected match updates the entry in place.
Each feed names a [WebSub](https://www.w3.org/TR/websub/) hub, which is told
of every change, so a reader that subscribes through it (Feedly, Inoreader
and NewsBlur, among others) gets a recap as soon as the feed does, not at
its next poll. The
feeds are rebuilt from the season files on every push
(`.github/workflows/feeds.yml`, `src/feeds/`), a minute or two after the
publisher's commit. [The index](https://feeds.quiet-football.com/)
lists them all, by conference and division, and each division is an OPML
file (`nfl/nfc-north.opml`, …) a reader imports to follow its four teams at
once.

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
matching rules and the data it changes land together.

- [docs/operating.md](docs/operating.md): the code's layout, gathering
  videos, rebuilding a season, checking the files and running the publisher
- [docs/design.md](docs/design.md): why the data is shaped this way
- [docs/scheduling.md](docs/scheduling.md): when the publisher works
- [docs/findings.md](docs/findings.md): what twelve seasons of recaps taught

Every push is checked (`npm run check`): each file must pass its schema and
be exactly what the publisher would write for it.

## License

[CC0 1.0](LICENSE): the data, schema and scripts are dedicated to the public
domain, so use them for anything, without asking or crediting.

CC0 waives only rights this project holds. A video and its title belong to
whoever posted it, and this dataset only points to them.
