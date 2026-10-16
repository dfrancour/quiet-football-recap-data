# Scheduling the publisher

How the publisher decides when to read ESPN and YouTube and when to write.

## What drives the work

Nearly everything hangs off one event, a game going final, and the timing
after it is measured from twelve seasons of recaps:

- A recap lands about 30 minutes after the final whistle: 3.2–4.0 hours
  after kickoff for 80% of games, up to 8.4 hours in the current era, and up
  to two days in older seasons.
- Readers expect a final game to appear in its season file within about 15
  minutes (a final game with no entry past that means the publisher is
  behind), so the publisher must see finals within a minute or two.
- Nothing else is urgent. Retitles, takedowns and gap repairs can wait
  hours.

So the publisher does not run on fixed intervals. It works out when the next
thing is due, from the data.

## A pure planner and a plain loop

`plan(state, now)` returns the actions due now and when to wake next. It is a
pure function, so it is tested with a fake clock ("Sunday 16:20, three games
just went final: read the uploads now, wake in 60 seconds").

Its state is the season file, which already records every game's status,
when it was seen final and what was found, plus a small local cache: the
videos seen, ESPN's latest view of the games around now, when each read last
ran, and the quota spent today. ETags are not used yet: whether a 304 saves
YouTube quota is still to verify (design.md).

The loop runs the actions, writes any transitions, commits and pushes, then
sleeps until the wake time, capped at an hour so a schedule change is never
missed for long.

A restart is just another pass: all state is on disk, and a season file is a
pure function of what the publisher knows, so a repeated pass changes
nothing.

## What gets planned

| Work                                          | When                                                                                                                                  | Cost      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| ESPN scoreboard for the current week          | Every minute from the first kickoff until every game that day is final; daily otherwise, for flexed games and a new season's schedule | free      |
| `track` a game                                | The pass that first sees it final                                                                                                     | none      |
| The uploads list's first page                 | While any game is `searching`, at the fastest cadence any of them needs (below)                                                       | 1 unit    |
| A search of one game's window                 | Once, 12 hours after final, for a game still `searching`                                                                              | 100 units |
| `miss` a game                                 | Three days after kickoff, still nothing                                                                                               | none      |
| A sweep of every linked video (`videos.list`) | Weekly, for takedowns and retitles                                                                                                    | ~75 units |

Each searching game wants the uploads read:

| After the game is final | Every      |
| ----------------------- | ---------- |
| up to 2 hours           | 1 minute   |
| 2 to 6 hours            | 5 minutes  |
| 6 to 24 hours           | 30 minutes |
| after that              | 3 hours    |

A busy Sunday comes to roughly 500–700 units of polling plus a few searches.

## Quota is an input

The planner knows the units left today. As the budget tightens it stretches
the long-tail cadences first and keeps the first two hours after a final,
when recaps actually land. Searches have their own daily cap, so gap repair
never starves live polling. A 403 means the quota is spent: the publisher
sleeps until it resets at midnight Pacific.

## Git is part of the schedule

- Pull before every pass. Hand corrections arrive as commits to
  `corrections.json`, and the publisher must see them before it writes. With
  one publisher and occasional human commits, the rebase is almost always
  trivial.
- Commit per transition and push once per pass. A failed push leaves the
  commits local for the next pass to retry; nothing needs queueing.

## Running it

- One container on the server, beside Quiet Football, with its own checkout
  on a volume and a lock so only one publisher runs.
- A status file with the last pass, the next wake, units spent and the last
  error: enough for a health check, and for the CLI to print.
- `run --once` and `backfill` from the CLI, and `status`, whose `--check`
  is the container's health check.
- Readers see a stalled publisher in the data itself (a final game with no
  entry), so a broken loop is noticed even if its status file is wrong.

## Decisions made in building it

`src/planner.ts` and `src/transitions.ts` hold these, with tests:

- **ESPN is read by day.** Its scoreboard takes one Eastern day
  (`dates=20261015`, not a range), and every event names its own season,
  season type and week. A live read covers the days of games in play; the
  daily catch-up also reads the current week (for upcoming kickoffs) and the
  last four days, so a restart finds every game whose window is still open.
- **`final_seen_at` is only claimed when watched**: the game was seen not
  final within the ten minutes before. A game first seen final after a gap
  is tracked without it.
- **A game first seen final after its window** (the publisher was down for
  days) is tracked `unknown`, never `missing`, which would claim the window
  was watched.
- **A game newly final reads the uploads in the same pass**, so a restart
  hours after a game tracks and adds it at once.
- **A better match replaces the publisher's own** while the window is open:
  a player's reel taken first gives way to the game's highlights, as a
  `correct` with `reason=game-highlights`. A backfilled match, a corrected
  one, and anything after the window are left alone.
- **A takedown** returns the game to `searching` inside the window. After
  it, the game is `missing` if it was found live and `unknown` if it was
  backfilled.
- **Quota stretching**: below half the day's 10,000 units nothing changes;
  past half the long tail doubles, past three quarters it quadruples, and
  past nine tenths everything slows to at least 30 minutes. Searches stop
  at nine tenths, and at 20 a day.
- **Pulls**: an unreachable remote is ridden out (commits wait locally); a
  conflicting rebase is aborted and the pass stops without writing. A
  checkout with uncommitted changes to the league's folder is never written
  over.
- **Matching runs over every video gathered**, which the publisher reads
  incrementally (the uploads list until a video it already has), so the
  cache never needs rebuilding the way a backfill's does.

## Deferred

Push notifications from YouTube (WebSub), more than one worker, and a job
queue. Each adds moving parts for latency that the upload lag already
swamps.
