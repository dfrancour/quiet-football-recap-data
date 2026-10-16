# Design

Why the dataset is shaped the way it is. The README says what is in it;
[scheduling.md](scheduling.md) says when the publisher works; and
[findings.md](findings.md) records what building it from twelve seasons of
recaps taught.

Status: the backfill (`src/cli.ts backfill`) and the live publisher
(`src/cli.ts run`) are built. The publisher is not yet deployed.

## The shape of it

This is _git scraping_: a scheduled process commits what it finds, and the
repo is the database, the change log and the public API at once.

- **The rules live with the data.** The matcher, its corpus of real titles,
  the corrections a person made, and the code that writes the files are all
  here, so a change to a rule and the data it changes land together, and
  anyone can rebuild the files from scratch.
- **One publisher writes; anyone reads.** The publisher runs on a server,
  with its own checkout, and pushes commits. Readers fetch
  `raw.githubusercontent.com/…/nfl/<season>.json` with `If-None-Match`, so an
  unchanged file costs a 304. Readers never depend on the publisher being up:
  if it stops, the files stay readable and only new recaps stop appearing.
- **One file per season.** A reader wants everything recent in one request,
  and a season is about 150 KB with every game and state. Git still keeps
  each game's history. If a file ever outgrows one request, splitting it by
  week (`nfl/2026/06.json`) changes the paths but not a single record.

## A game's lifecycle

Without states, a missing record could mean four things: the game isn't
over, the publisher hasn't got to it, it looked and found nothing yet, or it
gave up. So the publisher records a game as soon as it sees it final, before
there's any video, and every change after that is a state change:

```
                 publisher sees the game final
  (no entry) ─────────────────────────────────▶ searching
                                                 │     ▲
                                  recap matched  │     │  remove, inside the window
                                                 ▼     │
                                                found ─┘ ◀── correct (found → found)
                                                 ▲
             window closes      (correction      │
  searching ──────────────▶ missing ─────────────┘
                                     by hand)

  backfill: (no entry) ──▶ found | unknown        unknown ──▶ found (a later search)
```

| State       | Means                                                                       | Fields added           |
| ----------- | --------------------------------------------------------------------------- | ---------------------- |
| _no entry_  | The publisher hasn't seen this game final                                   | —                      |
| `searching` | Final; the publisher is looking and has found no recap yet                  | `final_seen_at`        |
| `found`     | Linked                                                                      | `video`, `detected_at` |
| `missing`   | The publisher watched the three days after kickoff and no recap was posted  | —                      |
| `unknown`   | Final, and a search that didn't watch the window (a backfill) found nothing | —                      |

`missing` is a claim that the window was watched, so only the live publisher
writes it. A backfill writes `unknown` for what it doesn't find: the recap
may exist, beyond what the search could reach.

The dataset only says what the publisher has done. Whether a recap is
expected at all comes from the game's own status, which every reader already
has from its schedule source. So there's no `scheduled` or `not_expected`
state:

- A game not yet played, postponed or canceled never becomes final, so it
  never gets an entry. The file doesn't repeat the schedule.
- If a game is wrongly called final and ESPN later undoes it, the publisher
  deletes its entry (`untrack`).

There's no "last searched at" field, on purpose: updating it would mean a
commit every minute per game, burying the real history. Whether the
publisher is keeping up is inferred instead.

### How a reader reads it

A reader combines its own view of a game with the dataset's entry. `GRACE`
is about 15 minutes: the publisher's minute, the CDN's five, and room to
spare.

| Reader's game            | Dataset entry        | Means                              |
| ------------------------ | -------------------- | ---------------------------------- |
| not final                | any or none          | No recap expected                  |
| final, under `GRACE` ago | none                 | The publisher hasn't caught up yet |
| final, over `GRACE` ago  | none                 | The publisher is behind or down    |
| final                    | `searching`          | Looked for, not posted yet         |
| final                    | `found`              | Linked                             |
| final                    | `missing`, `unknown` | Not linked; a search link is fair  |

The third row is the publisher's heartbeat, and it costs no commits: every
final game must be acknowledged within `GRACE`, so one that isn't is evidence
something is wrong. A reader that only loaded a season later can't tell how
long a game has been final, which can only delay the warning, never fake
one.

## A game is identified by what it is

The dataset maps games to videos. A source's id for a game (ESPN's event id,
or a reader's own) is a stand-in for the game, and keying on it would make
the dataset only as durable as that source. A game is identified by
**season, season type, week and its two teams**:

- **A team plays once a week**, so those pick out one game. Readers join on
  both teams in either orientation, so two sources that disagree about which
  side is home at a neutral site still agree on the game.
- **The identity is settled before it's written.** An entry appears only
  once a game is final, after any flex, move or postponement, so nothing
  rewrites a key.
- **The conventions are ESPN's**, and they are only conventions. Team codes
  are ESPN's abbreviations (`LAR`, `WSH`, `LV`) and weeks are ESPN's, so an
  ESPN-based reader joins with no mapping; another reader maps from them (for
  nflverse, `LAR` → `LA` and `WSH` → `WAS`).
- **One code per team across seasons**, the current one, so the Raiders are
  `LV` in 2019 too.
- **Season types are ESPN's** (`preseason`, `regular`, `postseason`), and
  part of the identity, since the preseason numbers its own weeks from 1.
  ESPN puts the Hall of Fame game alone in preseason week 1, so a team still
  plays once a week.
- **The postseason continues the regular season's count** (Wild Card is week
  19 of an 18-week season, the Super Bowl 22). It's the one departure from
  ESPN, which numbers the postseason from 1 with the Pro Bowl as a week whose
  place varies by era. The continuous count is also nflverse's.
- **Source ids are references, not keys.** `external_ids` carries ESPN's
  event id, and later any other source's. Unlike an nflverse id, which is a
  formula over the key, ESPN's can only be recovered by asking ESPN, so it's
  kept. Where it disagrees with the key, the key wins. It also tells events
  apart where the key can't: the 2017 Buccaneers–Dolphins game postponed for
  Hurricane Irma is ESPN's week 11 event, not the postponed week 1 one.

`games` is a list (git-history's ideal input), sorted by season type, then
week, kickoff and home team, so a change is a one-object diff. What JSON
Schema can't say (no team twice in a week, no source id on two games) is
checked by `scripts/check.mjs`.

## What a record holds

- **Every game the publisher has seen final**, whatever its state, and no
  other.
- **Domain time stays apart from record time.** `kickoff` and
  `published_at` are facts about the world. `final_seen_at` and
  `detected_at` are when the publisher saw each thing happen, and appear
  only when it watched live; a backfill has neither. None of them changes on
  a rewrite. The commit carries when the record changed, so there's no
  metadata block.
- **No confidence score.** The matcher is a set of rules, so a decimal would
  be made up. The commit says which build made a match.
- **Facts, not presentation.** A title is stored verbatim, even when it gives
  the result away ("The 28-3 Comeback"). Hiding spoilers is the reader's
  job. There's no description, thumbnail or score only because nothing needs
  them.
- **One canonical form.** A season file is a pure function of what the
  publisher knows: 2-space JSON, keys in schema order, instants to the
  second, a final newline. Writing it again without news changes no byte, so
  no commit is ever noise. `scripts/check.mjs` enforces the form.

## Commits are the change log

Each state change is one commit, and its message names the change and the
game:

```
backfill(nfl 2024): 334 games, 283 found, 51 unknown
track(nfl 2026 W6 DAL@PHI): final, searching
add(nfl 2026 W6 KC@BUF): abc123xyz_0 "Chiefs vs. Bills Game Highlights | …"
correct(nfl 2026 W6 KC@BUF): def456uvw_1 -> abc123xyz_0, reason=game-highlights
retitle(nfl 2026 W5 LV@NE): "Los Vegas Raiders vs. …" -> "Las Vegas Raiders vs. …"
remove(nfl 2026 W6 KC@BUF): reason=wrong-match
miss(nfl 2026 W6 SF@SEA): window closed
untrack(nfl 2026 W6 NYJ@MIA): no longer final

Publisher: <commit of the build that made it>
```

- `git log -- nfl/2026.json` is a season's history, and
  `git log --grep='nfl 2026 W6 KC@BUF'` one game's.
- `correct` and `remove` over `add` is the matcher's error rate, and `miss`
  its coverage gaps. `backfill` commits are left out of both.
- GitHub serves the history as an Atom feed (`/commits/main.atom`), so "a
  recap was posted" is subscribable with no code. Per-team feeds that list
  only `add` can follow.
- The publisher commits as a bot identity, never as a person, and a person's
  correction is a commit to `nfl/corrections.json`. The two can be told
  apart, which the error rate depends on.

## Failure modes

Every failure should make recaps late, never wrong or unreachable.

| Failure                              | Effect                       | Handling                                                                     |
| ------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------- |
| Publisher down                       | No new recaps                | Readers see final games with no entry past `GRACE`; on restart it catches up |
| Down past a game's three-day window  | That game was never watched  | A backfill of the season fills it, or leaves it `unknown`                    |
| YouTube errors or the quota runs out | Detection late               | Back off; on a 403, sleep until the quota resets at midnight Pacific         |
| Push fails                           | Data late                    | The commits stay local and the next pass pushes them; nothing is queued      |
| A person's correction arrives        | —                            | The publisher pulls before every pass, so it never writes over one           |
| Wrong match published                | Wrong recap linked           | A correction in `nfl/corrections.json`, and the title added to the corpus    |
| Reader can't reach GitHub            | No new recaps on that reader | What it has keeps showing                                                    |

## Measurement

Each record has its kickoff, publish and detection times, so the dataset
can report on itself, and the history is the database:
[git-history](https://github.com/simonw/git-history) turns it into SQLite
with one row per version of each game (see the README). From that:

- **Upload lag**: `final_seen_at` to `published_at`, per kickoff slot. It
  sets the publisher's cadence, so it's measured, not assumed.
- **Detection lag**: `published_at` to `detected_at`, the publisher's own
  number to keep low.
- **Matcher accuracy**: `correct` and `remove` over `add`, per season and
  per build.
- **Coverage**: `found` over everything tracked, with every `missing` game
  named.

Backfilled records have no observed times, so they drop out of the lag
figures by construction. Stats are published elsewhere (GitHub Pages), never
committed to `main`, so its history stays nothing but state changes.

## Lessons from git scraping

Simon Willison [named the pattern](https://simonwillison.net/2020/Oct/9/git-scraping/);
his [git-history](https://simonwillison.net/2021/Dec/7/git-history/) post is
about analysing what it collects. Against this design:

- **Commit only on change.** His scrapers run `git commit … || exit 0`. The
  stronger form here is that a file is a pure function of what the publisher
  knows. The first backfill broke it: a `closed_at` field held the time of
  the run, so every rerun would have rewritten every gap. It's gone, and a
  rerun is byte-identical.
- **Strip fields that change without news**, git-history's advice. It's why
  there's no heartbeat or "last searched at".
- **Pretty-print for line diffs, in one form.** He pipes through `jq .`;
  here the form is fixed and checked.
- **A list of objects with a stable id.** `games` is a list, and its id is
  compound. That's why every record carries its season and season type:
  otherwise part of its identity would live only in the file name.
- **Readable commit messages.** His tree scraper wrote them with `csv-diff`.
  Here they're structured, since the error rate is computed from them.
- **Who committed matters.** His commits are by "Automated"; here the bot
  identity also separates the publisher from a person's corrections.
- **Be polite.** He runs off the hour. Readers here start polling from their
  own boot times, so they don't all ask at once.
- **Be findable**: the `git-scraping` topic.

One divergence: his scrapers run on GitHub Actions' schedule. Its runs can be
delayed by many minutes, around the top of the hour, when games end, so this
one runs on a server instead. The code is still all here, so a fork is a
complete working copy.

## Alternatives considered

| Option                                  | Why not                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The channel's RSS feed                  | It holds 15 entries, about 26 minutes deep on a game day, mostly short clips; recaps fall off      |
| GitHub Actions as the scheduler         | A 5-minute floor, delays near the top of the hour, and schedules disabled after 60 quiet days      |
| The publisher inside Quiet Football     | Matching would live in the app; here, a rule and the data it changes land together                 |
| One file per game                       | Readers would poll for 404s game by game; git keeps each game's history from one file just as well |
| An API server for reads                 | Readers would break whenever it was down                                                           |
| A heartbeat or "last searched at" field | A commit every minute would bury the history; an unacknowledged final game says the same thing     |
| Listing every scheduled game            | Repeats the schedule and churns with every flex; readers know which games are final                |
| Keying by ESPN's event id               | Ties the dataset to one source; kept as a reference in `external_ids`                              |
| Storing the nflverse id                 | It's a formula over season, week and teams                                                         |
| Confidence scores                       | The matcher is rules; a decimal would be made up                                                   |
| Leaving titles out, since some spoil    | A title is a fact; hiding spoilers is the reader's job                                             |

## Still to verify

- [ ] How long `raw.githubusercontent.com` caches a file after a commit, and
      its rate limit for unauthenticated reads with `If-None-Match`
- [ ] Whether a 304 from `playlistItems.list` with an ETag still costs a
      quota unit
- [ ] That ESPN's abbreviations are stable within a season (a changed code
      would orphan entries)
- [ ] `oneOf` on `status` gives noisy validation errors (every branch
      reports); `if`/`then` on `status` would read better
