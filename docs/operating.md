# Operating the dataset

How the code is laid out, how a season is gathered and rebuilt, how the
files are checked, and how the live publisher runs. The README says what is
in the data; [design.md](design.md) says why it is shaped that way.

## The code

```
nfl/                 the dataset: season files, schema, corrections
src/
  model.ts           what everything speaks in: League, Team, Game, Video
  leagues/nfl.ts     the NFL's teams, divisions, channel and ESPN endpoints
  matcher.ts         which video is a game's recap
  dataset.ts         the season file, and the one way it is written
  corrections.ts     matches decided by a person
  cache.ts           the videos gathered so far
  collect.ts         gathering videos from YouTube into the cache
  backfill.ts        a season rebuilt from its schedule and the cache
  check.ts           npm run check
  cli.ts             every other command
  sources/           ESPN's scoreboard and the YouTube Data API
  publisher/         the live publisher: its pass and loop, planner,
                     transitions and git checkout
  feeds/             the Atom feeds, the page and OPML files that list
                     them, the site's icons, and the WebSub ping
test/                the same layout as src/
deploy/              the publisher's image and compose file
```

Everything depends on `model.ts`, and it depends on nothing. A league's own
facts live in `leagues/`, so the rest of the code takes a `League` rather
than naming the NFL.

- `matcher.ts` decides which video is a game's recap: a title that says
  "highlights" or is only the matchup, never a preview, naming both teams,
  published within three days of kickoff. Publish time pins the game; a week
  in the title only breaks ties.
- `sources/espn.ts` reads each season's schedule from ESPN's scoreboard, and
  numbers its weeks as the README describes.
- `sources/youtube.ts` reads the channel's videos: its uploads, its
  playlists, a search within a time window, and a lookup by id. It counts the
  quota each call spends.
- `leagues/nfl.ts` holds each team's codes, names and former names
  ("Redskins", "Oakland"), and the divisions the feeds' index lists.
- `backfill.ts` builds a season after the fact from its schedule and the
  videos gathered for it. Nothing in it was watched live, so a game with no
  recap is `unknown`.
- `publisher/transitions.ts` is what the live publisher changes, given what
  it knows: track, add, correct, retitle, remove, miss and untrack, each one
  game's new record and its commit message.
- `publisher/planner.ts` decides when the publisher reads ESPN and YouTube,
  from the data and the quota left ([scheduling.md](scheduling.md)).
- `publisher/run.ts` runs a pass (pull, read what is due, commit each
  change, push) and the loop around it; `publisher/git.ts` is its checkout.
- `nfl/corrections.json` holds matches decided by a person: a recap whose
  title follows no rule, or a match the rules got wrong. The matcher never
  overrides one. Each names its game, the video (or `null` for none) and a
  reason.
- `test/` holds the titles the NFL has actually used, every quirk included.
  A new quirk belongs there.

```bash
npm ci
npm test
npm run typecheck
```

## Gathering videos

Videos are gathered into `.cache/nfl-videos.json` (not in git), which also
remembers the searches already run so none is paid for twice. Gathering
needs a YouTube Data API key in `.env` (`YOUTUBE_API_KEY=…`).

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

## Rebuilding a season

Rebuild seasons from ESPN's schedules, the gathered videos and the
corrections:

```bash
node src/cli.ts backfill 2015-2026
```

A backfill rewrites a season from the cache alone, so a fresh checkout must
gather the whole season (`collect uploads --since` the preseason) before it
adds a game; a rewrite that would take a recap away from a game found before
is refused unless `--allow-loss` says so.

If the publisher is down, a recap can still be added by hand:

```bash
node --env-file=.env src/cli.ts collect uploads --since 2026-08-01T00:00:00Z
node src/cli.ts backfill 2026
npm run check && git diff
```

## Checking

```bash
npm ci
npm run check
```

`src/check.ts` checks every league's files, and CI runs it on every push:

- each season file passes its league's schema
- each is exactly what the publisher would write for it
  (`serializeSeasonFile`): keys in schema order, games sorted, 2-space JSON
  with a final newline. The format is defined once, in `src/dataset.ts` and
  the schema, and the check reuses it rather than restating it
- its name and games match its season
- no team plays itself or twice in a week, and no source's id names two
  games
- the schema's teams are the league's (`src/leagues/`)
- each correction names known teams, and no game is corrected twice

A file is a pure function of what the publisher knows, so writing it again
without news changes no byte and makes no commit.

## Running the publisher

`run` is the live publisher. It works in its own checkout, commits as its
own identity, and pushes after every pass, so try it on a scratch clone with
`--no-push` first:

```bash
node --env-file=.env src/cli.ts run --once --no-push --data /tmp/trial --clone "$PWD"
node src/cli.ts status --data /tmp/trial
```

On the server it runs in a container (`deploy/Dockerfile`,
`deploy/compose.yaml`) with its checkout and cache on a volume. In the
repository's root it needs `.env` with `YOUTUBE_API_KEY` (and, optionally,
`PUBLISHER_GIT_NAME` and `PUBLISHER_GIT_EMAIL` for the bot identity), and
`deploy_key`, the private half of a deploy key with write access to this
repository, readable by uid 1000. Then, from the root:

```bash
PUBLISHER_BUILD=$(git rev-parse --short=12 HEAD) docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml logs -f publisher
```

The first start clones the repository onto the volume. `status --check` is
the container's health check: it fails when no pass has run in two hours or
the publisher is ten minutes past when it meant to wake.

## The feeds

`.github/workflows/feeds.yml` builds the feeds on every push that can
change them, and serves them from GitHub Pages:

```bash
node src/cli.ts feeds --out _site
```

Before it deploys, the workflow compares every file it built with the one
served (`--changed`, `src/feeds/served.ts`):

- A build that changes nothing is not deployed. Most of the publisher's
  pushes change no feed (a game going final, a recap still searched for, a
  retitle), and Pages dates every file by its deploy, so each needless one
  would give every feed a new `ETag` and every reader a full download. A
  manual run (`workflow_dispatch`) deploys regardless, which is how to drop
  a file the build no longer writes.
- Each feed names a WebSub hub (Google's). Once the deploy is live, the
  workflow pings it with the feeds that changed, and the hub pushes them to
  readers subscribed through it. A recap changes three feeds (the league's
  and its two teams'). A failed ping shows on the run but fails nothing,
  since readers still poll.
