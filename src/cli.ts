/**
 * The dataset's command line.
 *
 *   node src/cli.ts backfill 2015-2026 [--allow-loss]
 *   node --env-file=.env src/cli.ts collect uploads [--since 2026-09-01] [--max-pages 400]
 *   node --env-file=.env src/cli.ts collect playlists --match "highlights" [--exclude "player"]
 *   node --env-file=.env src/cli.ts collect gaps 2015-2026 [--per-game] [--types preseason]
 *   node --env-file=.env src/cli.ts collect ids GP9zR_SKRr0 ...
 *   node --env-file=.env src/cli.ts run [--once] [--no-push] [--data <dir>] [--clone <url>]
 *   node src/cli.ts status [--data <dir>] [--check]
 *   node src/cli.ts feeds [--out _site] [--base-url https://…/]
 *
 * `backfill` reads each season's schedule from ESPN, matches it against the
 * gathered videos and `nfl/corrections.json`, and rewrites `nfl/<season>.json`.
 * `collect` gathers videos into the cache from YouTube, which needs
 * `YOUTUBE_API_KEY`. `run` is the live publisher (src/publisher/run.ts), and
 * `status` reports on it; `status --check` exits non-zero when it looks
 * stalled, for a health check. `feeds` writes the current season's Atom
 * feeds (src/feeds/atom.ts), the page that lists them and an OPML file per
 * division (src/feeds/site.ts), and the icons in src/feeds/assets, for
 * GitHub Pages. Checking the files is src/check.ts, apart from this, since
 * it needs the dev dependencies the publisher's image leaves out.
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { backfillSeason, lostRecaps } from "./backfill.ts";
import { VideoCache } from "./cache.ts";
import {
  collectGaps,
  collectIds,
  collectPlaylists,
  collectUploads,
  gapWindows,
  type GapGame,
} from "./collect.ts";
import { correctionsSchema } from "./corrections.ts";
import { parseSeasonFile, serializeSeasonFile } from "./dataset.ts";
import { buildFeeds } from "./feeds/atom.ts";
import { buildSite } from "./feeds/site.ts";
import { NFL } from "./leagues/nfl.ts";
import { GitRepo } from "./publisher/git.ts";
import {
  healthy,
  paths,
  readStatus,
  runLoop,
  type PublisherOptions,
} from "./publisher/run.ts";
import { fetchEspnJson, fetchSeasonSchedule } from "./sources/espn.ts";
import { YouTube, YouTubeError } from "./sources/youtube.ts";

/** The one league so far. */
const LEAGUE = NFL;

const ROOT = new URL("../", import.meta.url).pathname;
const DIR = `${ROOT}${LEAGUE.id}`;
const CACHE = `${ROOT}.cache/${LEAGUE.id}-videos.json`;

/** The fields of a season file's games that collecting and checking need. */
const seasonGamesSchema = z.object({
  games: z.array(
    z.object({
      season: z.number(),
      season_type: z.string(),
      week: z.number(),
      away: z.string(),
      home: z.string(),
      kickoff: z.string(),
      status: z.string(),
    }),
  ),
});

/** "2015-2026" or "2015,2017" or "2026". */
export function parseSeasons(spec: string): number[] {
  return spec.split(",").flatMap((part) => {
    const [from, to] = part.split("-").map(Number);
    if (!from || (to !== undefined && !to)) {
      throw new Error(`Not a season or range: ${part}`);
    }
    const last = to ?? from;
    return Array.from({ length: last - from + 1 }, (_, i) => from + i);
  });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function backfill(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { "allow-loss": { type: "boolean", default: false } },
  });
  const [spec] = positionals;
  if (!spec) throw new Error("Which seasons? e.g. backfill 2015-2026");

  const videos = VideoCache.read(CACHE).videos;
  const corrections = correctionsSchema.parse(
    readJson(`${DIR}/corrections.json`),
  );

  for (const season of parseSeasons(spec)) {
    const schedule = await fetchSeasonSchedule(season, { league: LEAGUE });
    const file = backfillSeason(
      season,
      schedule,
      videos,
      corrections,
      LEAGUE.teams,
    );
    const path = `${DIR}/${season}.json`;
    const before = existsSync(path)
      ? seasonGamesSchema.parse(readJson(path))
      : null;
    const lost = lostRecaps(before, file);
    if (lost.length > 0 && !values["allow-loss"]) {
      throw new Error(
        `${season}: ${lost.length} game(s) found before would be unknown now: ${lost.join(", ")}. ` +
          "The cache is probably missing videos (collect uploads --since an earlier date); --allow-loss writes anyway.",
      );
    }
    writeFileSync(path, serializeSeasonFile(file));
    const found = file.games.filter((game) => game.status === "found").length;
    console.log(
      `${season}: ${file.games.length} games, ${found} found, ${file.games.length - found} unknown`,
    );
  }
}

function youtube(): YouTube {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set YOUTUBE_API_KEY, e.g. node --env-file=.env src/cli.ts",
    );
  }
  return new YouTube({ apiKey });
}

async function collect(args: string[]): Promise<void> {
  const [source, ...rest] = args;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      since: { type: "string", default: "2000-01-01T00:00:00Z" },
      "max-pages": { type: "string", default: "400" },
      match: { type: "string" },
      exclude: { type: "string" },
      "per-game": { type: "boolean", default: false },
      types: { type: "string", default: "preseason,regular,postseason" },
      hours: { type: "string", default: "12" },
      "max-searches": { type: "string", default: "40" },
      pages: { type: "string", default: "3" },
    },
  });
  const client = youtube();
  const cache = VideoCache.read(CACHE);
  try {
    switch (source) {
      case "uploads":
        report(
          await collectUploads(
            client,
            cache,
            LEAGUE.channelId,
            values.since,
            Number(values["max-pages"]),
          ),
        );
        break;
      case "playlists": {
        if (!values.match) throw new Error("collect playlists --match <regex>");
        report(
          await collectPlaylists(
            client,
            cache,
            LEAGUE.channelId,
            new RegExp(values.match, "i"),
            values.exclude ? new RegExp(values.exclude, "i") : null,
          ),
        );
        break;
      }
      case "gaps": {
        const [spec] = positionals;
        if (!spec) throw new Error("Which seasons? e.g. collect gaps 2023");
        const types = new Set(values.types.split(","));
        const games: GapGame[] = parseSeasons(spec).flatMap((season) =>
          seasonGamesSchema
            .parse(readJson(`${DIR}/${season}.json`))
            .games.filter(
              (game) =>
                game.status === "unknown" && types.has(game.season_type),
            ),
        );
        const windows = gapWindows(games, LEAGUE.teams, {
          hours: Number(values.hours),
          perGame: values["per-game"],
        });
        console.log(
          `${games.length} games without a recap, ${windows.length} windows`,
        );
        report(
          await collectGaps(client, cache, LEAGUE.channelId, windows, {
            maxSearches: Number(values["max-searches"]),
            pagesPerWindow: Number(values.pages),
          }),
        );
        break;
      }
      case "ids":
        report(await collectIds(client, cache, positionals));
        break;
      default:
        throw new Error("collect uploads|playlists|gaps|ids");
    }
  } catch (error) {
    if (!(error instanceof YouTubeError)) throw error;
    console.error(
      error.quotaExceeded
        ? "Stopped: today's YouTube quota is spent (it resets at midnight Pacific)."
        : `Stopped: ${error.message}`,
    );
    process.exitCode = 1;
  } finally {
    cache.write(CACHE);
    console.log(
      `${client.unitsSpent} units spent; cache holds ${cache.videos.length} videos`,
    );
  }
}

function report(result: object): void {
  console.log(
    Object.entries(result)
      .map(
        ([name, value]) =>
          `${name}: ${Array.isArray(value) ? value.join(" ") || "none" : value}`,
      )
      .join(", "),
  );
}

/** The commit of this code: `PUBLISHER_BUILD`, or this checkout's HEAD. */
function build(): string {
  if (process.env.PUBLISHER_BUILD) return process.env.PUBLISHER_BUILD;
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

async function publish(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      once: { type: "boolean", default: false },
      "no-push": { type: "boolean", default: false },
      data: { type: "string", default: ROOT },
      clone: { type: "string" },
    },
  });
  const dataDir = values.data;
  if (values.clone) await GitRepo.cloneIfMissing(values.clone, dataDir);
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("Set YOUTUBE_API_KEY");

  const identity = {
    name: process.env.PUBLISHER_GIT_NAME ?? "quiet-football-recap-publisher",
    email:
      process.env.PUBLISHER_GIT_EMAIL ??
      "quiet-football-recap-publisher@users.noreply.github.com",
  };
  const options: PublisherOptions = {
    dataDir,
    league: LEAGUE,
    fetchJson: fetchEspnJson,
    youtube: () => new YouTube({ apiKey }),
    git: new GitRepo(dataDir, identity),
    push: !values["no-push"],
    build: build(),
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  };

  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      options.log(`${signal}: stopping after this pass`);
      stop.abort();
    });
  }
  options.log(
    `publisher ${options.build} in ${dataDir} as ${identity.name}${options.push ? "" : ", not pushing"}`,
  );
  await runLoop(options, { signal: stop.signal, once: values.once });
}

async function status(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      data: { type: "string", default: ROOT },
      check: { type: "boolean", default: false },
    },
  });
  const current = readStatus(paths(values.data, LEAGUE.id).status);
  const ok = healthy(current, Date.now());
  if (!values.check || !ok) {
    console.log(current ? JSON.stringify(current, null, 2) : "No pass yet.");
  }
  if (values.check && !ok) process.exitCode = 1;
}

const PAGES_URL = "https://feeds.quiet-football.com/";

async function feeds(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      out: { type: "string", default: "_site" },
      "base-url": { type: "string", default: PAGES_URL },
    },
  });
  const baseUrl = values["base-url"].replace(/\/*$/, "/");
  const seasons = readdirSync(DIR)
    .map((name) => /^(\d{4})\.json$/.exec(name)?.[1])
    .filter((season) => season !== undefined)
    .map(Number);
  const season = Math.max(...seasons);
  const file = parseSeasonFile(readFileSync(`${DIR}/${season}.json`, "utf8"));
  const feeds = buildFeeds({ league: LEAGUE, file, baseUrl });
  const pages = buildSite({ league: LEAGUE, baseUrl });
  for (const [path, text] of [...feeds, ...pages]) {
    const target = join(values.out, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  // The icons, Quiet Football's own.
  cpSync(`${ROOT}src/feeds/assets`, values.out, { recursive: true });
  const found = file.games.filter((game) => game.status === "found").length;
  console.log(
    `${season}: ${feeds.size} feeds, ${found} recaps, in ${values.out}`,
  );
}

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  backfill,
  collect,
  feeds,
  run: publish,
  status,
};

const [command, ...rest] = process.argv.slice(2);
const run = command ? COMMANDS[command] : undefined;
if (!run) {
  console.error(`Usage: node src/cli.ts <${Object.keys(COMMANDS).join("|")}>`);
  process.exit(2);
}
await run(rest);
