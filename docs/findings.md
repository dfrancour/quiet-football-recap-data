# Findings

What building the dataset from twelve seasons of the NFL channel's recaps
taught, in the order it was learned (October 2026). The matcher's rules in
`src/matcher.ts` and the conventions in [design.md](design.md) come from
here.

## Where things stand

| Season | Regular season and postseason | Preseason |
| ------ | ----------------------------- | --------- |
| 2015   | 265 of 267                    | 64 of 65  |
| 2016   | 267 of 267                    | 64 of 64  |
| 2017   | 267 of 267                    | 64 of 64  |
| 2018   | 266 of 267                    | 62 of 65  |
| 2019   | 266 of 267                    | 65 of 65  |
| 2020   | 269 of 269                    | canceled  |
| 2021   | 285 of 285                    | 23 of 48  |
| 2022   | 283 of 284                    | 48 of 49  |
| 2023   | 281 of 285                    | 0 of 49   |
| 2024   | 283 of 285                    | 0 of 49   |
| 2025   | 285 of 285                    | 49 of 49  |
| 2026   | 79 of 79 (to week 5)          | 49 of 49  |

No video is linked to two games. The rest are `unknown`, and are covered
under [What's left](#whats-left).

## Timing

- **A recap lands about half an hour after the final whistle.** From kickoff
  to publish, 80% fall between 3.2 and 4.0 hours in the current era, the
  median is about 3.5 hours, and the latest seen is 8.4 hours (2024 CIN@CLE,
  a 1 p.m. game). This sets the publisher's cadence.
- **Older uploads were slower.** The median was 5.3 hours in 2015, with
  outliers of 24–40 hours in 2015, 2017 and 2020, settling near 3.4 hours
  from 2018 on. A three-day window from kickoff covers every one, and two
  teams never meet twice inside it, so publish time alone pins the game.

## Where the videos are

- **The uploads list holds only about the last 20,000 videos.** The channel
  had 60,239, but its uploads playlist reached back only to September 8, 2024. The long-form-only list (`UULF`) is no help: it and the Shorts list
  split the same ~19,000.
- **Curated playlists reach back to 2015.** The channel has 2,940
  playlists, including a "Game Highlights" playlist per week from 2015, and
  reading a playlist costs the same 1 unit per 50 videos. 435 highlight
  playlists gave 5,776 videos for 510 units; 244 preseason playlists, 309
  more.
- **The playlists have gaps**, worst in 2021–2023 (some 2023 weeks list 6–12
  videos for 16 games), and none covers the 2023 or 2024 preseason.
- **A window search fills most gaps.** One `search.list` call per game day
  (the window from the first kickoff to 12 hours after the last, query "vs")
  returned every recap in the windows tried, both 2023 conference
  championships and Super Bowl LVIII included. 78 searches (7,800 units)
  found 153 more recaps and changed no existing match.
- **Retitled and mislabelled recaps exist.** Some 2015 recaps were renamed
  into a year-end series ("#16: Ravens vs. Browns (Week 12) | Top 20 Games of
  2015"), posted within hours of their games; a 2022 recap is titled "Game
  Preview" though posted after the game; a 2018 one is a headline
  ("Fitzmagic Leads a Wild Upset!"). No rule should take these; they are
  corrections.

## Titles

The NFL types titles by hand, and every rule in the matcher answers a real
one:

- **The week in a title can be wrong**: "Week 7" on a week 8 Thursday game,
  "Week 2022" where the week goes. Requiring the week to agree cost three
  games and prevented no wrong match, so it only breaks ties.
- **Nicknames are typed singular** ("New York Giant"), and a location two
  teams share can't rescue them, so the singular counts.
- **Old titles use old names alone**: every Washington recap of 2015–2019
  says only "Redskins". Former names (Redskins, Oakland, San Diego, St.
  Louis) are data on each team, accepted in every season; that's safe while
  no other team has used them.
- **The 2026 preseason dropped the word**: "Chicago Bears vs Tennessee Titans
  | 2026 Preseason Week 3". A title that is exactly the two teams before its
  first bar counts.
- **That rule needed a rank and a guard.** Ranked first, matchup-only titles
  pulled in 2018's "Game Pass Condensed Game of the Week" over the recaps,
  and matched "Browns vs. Steelers | NFL 2021 Super Wild Card Weekend
  Preview" to their week 17 game. Now the game's own highlights rank first,
  other highlights second and a bare matchup last, and a preview is never a
  recap. As a side effect, eleven 2015 player reels gave way to the games'
  own highlights.
- **Choosing between candidates matters only in old seasons**: 63 games in
  2015–2017 had more than one; none have since.
- **Titles are edited after posting** ("Los Vegas Raiders" became "Las
  Vegas Raiders"), so the publisher keeps the latest title (`retitle`) while
  the match stays put.
- **Titles can spoil**: "Falcons Spoil Panthers Perfect Season", "Super Bowl
  LI Game Highlights | The 28-3 Comeback", "LARGEST COMEBACK IN HISTORY!".
  The dataset keeps them as facts; readers must not show them.

## The schedule

- **ESPN numbers the preseason from 1, with the Hall of Fame game alone in
  week 1**, so a team still plays once a week, and the NFL's "Preseason Week
  1" is week 2 here.
- **ESPN puts the Pro Bowl among the postseason weeks** (week 4 or 5, by
  era), so the Super Bowl is found by its headline, and the postseason
  continues the regular season's count instead.
- **Cancellations and postponements need nothing special.** The 2016 Hall of
  Fame game, all of 2020's preseason, 2017 DAL@HOU and 2021 ARI@NO
  (hurricanes), and 2022's BUF@CIN were canceled, so they never become final
  and have no entry. 2017's TB@MIA, postponed for Hurricane Irma, stays
  `postponed` at week 1 in ESPN and was played as a new event in week 11,
  where it's matched.
- **The postseason numbering holds up**: all 13 playoff games of 2024 matched
  at weeks 19–22, including the Wild Card game the Rams hosted in Glendale,
  and their week 8 and week 19 meetings with the Vikings stayed apart.

## The data model

- **A backfilled time is not an observed time.** Recaps linked in one sweep
  showed a median of 14 days from publish to "detected", which means
  nothing. So `final_seen_at` and `detected_at` appear only when the
  publisher watched live.
- **Never searched is not `missing`.** A season nobody searched has no
  recaps for a reason that says nothing about the NFL, and a game older than
  the search could reach is not one the NFL failed to post. Hence `unknown`.
- **A file must be a pure function of what's known.** A `closed_at` holding
  the time of the run made every rerun rewrite every gap. It's gone.
- **Size**: about 460 bytes a game, about 150 KB for a season with its
  preseason.

## What's left

- **11 regular-season and postseason games are `unknown`.**
  - Three have recaps that no rule should take, waiting for corrections once
    their lengths confirm they're recaps: 2015 BAL@CLE ("#16 … Top 20 Games
    of 2015"), 2018 TB@NO ("Fitzmagic Leads a Wild Upset!") and 2022 CIN@NE
    ("… Game Preview").
  - Two are 2024's week 1 Thursday and Friday games (BAL@KC, GB@PHI), before
    the uploads list and not yet searched.
  - Six sat in windows too busy for one search, and want a search per game:
    2015 CHI@GB, 2019 CHI@GB, and 2023 MIN@PHI, ATL@DET, DEN@MIA and
    NYG@PHI.
- **Two 2015 matches are likely wrong**, each linked to something other than
  the "Top 20 Games of 2015" video posted within hours of the game: DEN@KC
  links "Broncos vs. Chiefs RAW Highlights" (posted 40 hours after kickoff,
  against five for "#4"), and GB@DET links a "Matthew Stafford Highlights"
  reel (against "#8"). Corrections, once checked.
- **128 preseason games are `unknown`**, mostly 2021, 2023 and 2024: the
  window search, run over the preseason.
