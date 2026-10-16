import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseSeasonFile, serializeSeasonFile } from "../src/dataset.ts";
import { GitConflictError, GitRepo } from "../src/git.ts";
import type { Video } from "../src/matcher.ts";
import { NFL_TEAMS, nflTeam } from "../src/nfl/teams.ts";
import {
  acquireLock,
  healthy,
  paths,
  readStatus,
  runPass,
  seasonOf,
  type PublisherOptions,
} from "../src/publisher.ts";
import { YouTube } from "../src/youtube.ts";

const MINUTE = 60_000;
const BOT = { name: "Test Publisher", email: "publisher@example.com" };
const PERSON = { name: "A Person", email: "person@example.com" };

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: PERSON.name,
      GIT_AUTHOR_EMAIL: PERSON.email,
      GIT_COMMITTER_NAME: PERSON.name,
      GIT_COMMITTER_EMAIL: PERSON.email,
    },
  }).trim();
}

/** A bare remote holding an empty 2026 season, and the publisher's clone of it. */
function repos() {
  const root = mkdtempSync(join(tmpdir(), "publisher-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const data = join(root, "data");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  git(root, "clone", "--quiet", remote, seed);
  mkdirSync(join(seed, "nfl"));
  writeFileSync(
    join(seed, "nfl", "2026.json"),
    serializeSeasonFile({ season: 2026, games: [] }),
  );
  writeFileSync(join(seed, "nfl", "corrections.json"), "[]\n");
  writeFileSync(join(seed, ".gitignore"), ".cache/\n");
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "Seed");
  git(seed, "push", "--quiet", "-u", "origin", "main");
  git(root, "clone", "--quiet", remote, data);
  return { root, remote, seed, data };
}

interface World {
  status: "scheduled" | "in_progress" | "final";
  uploads: Video[];
  /** Ids the videos endpoint still knows, with their titles. */
  live: Map<string, Video>;
  espnReads: string[];
  youtubeReads: string[];
}

const KICKOFF = "2026-10-18T17:00Z";

/** ESPN's scoreboard, with SEA@DEN on Sunday 2026-10-18 in whatever state. */
function espn(world: World) {
  return async (url: string) => {
    world.espnReads.push(url);
    const name = {
      scheduled: "STATUS_SCHEDULED",
      in_progress: "STATUS_IN_PROGRESS",
      final: "STATUS_FINAL",
    }[world.status];
    const sunday = url.endsWith("dates=20261018") || !url.includes("dates=");
    return {
      events: sunday
        ? [
            {
              id: "401872999",
              date: KICKOFF,
              season: { year: 2026, type: 2 },
              week: { number: 7 },
              competitions: [
                {
                  competitors: [
                    { homeAway: "home", team: { id: nflTeam("DEN").espnId } },
                    { homeAway: "away", team: { id: nflTeam("SEA").espnId } },
                  ],
                  status: { type: { name } },
                },
              ],
            },
          ]
        : [],
    };
  };
}

/** YouTube's API: the uploads playlist, newest first, and videos by id. */
function youtube(world: World) {
  return () =>
    new YouTube({
      apiKey: "test-key",
      fetch: async (raw) => {
        const url = new URL(raw);
        world.youtubeReads.push(url.pathname.split("/").at(-1)!);
        if (url.pathname.endsWith("/playlistItems")) {
          return Response.json({
            items: [...world.uploads].reverse().map((video) => ({
              snippet: { title: video.title },
              contentDetails: {
                videoId: video.youtubeId,
                videoPublishedAt: video.publishedAt,
              },
            })),
          });
        }
        if (url.pathname.endsWith("/videos")) {
          const ids = url.searchParams.get("id")!.split(",");
          return Response.json({
            items: ids.flatMap((id) => {
              const video = world.live.get(id);
              return video
                ? [
                    {
                      id,
                      snippet: {
                        title: video.title,
                        publishedAt: video.publishedAt,
                      },
                    },
                  ]
                : [];
            }),
          });
        }
        return Response.json({ items: [] });
      },
    });
}

const recap: Video = {
  youtubeId: "6uFD3NGt0GE",
  title:
    "Seattle Seahawks vs Denver Broncos Game Highlights | 2026 NFL Season Week 7",
  publishedAt: "2026-10-18T20:40:00Z",
};

function setup() {
  const dirs = repos();
  const world: World = {
    status: "in_progress",
    uploads: [
      {
        youtubeId: "zzzzzzzzzzz",
        title: "Every touchdown from Week 6",
        publishedAt: "2026-10-14T12:00:00Z",
      },
    ],
    live: new Map(),
    espnReads: [],
    youtubeReads: [],
  };
  const options: PublisherOptions = {
    dataDir: dirs.data,
    league: "nfl",
    teams: NFL_TEAMS,
    channelId: "UCDVYQ4Zhbm3S2dlz7P1GBDg",
    fetchJson: espn(world),
    youtube: youtube(world),
    git: new GitRepo(dirs.data, BOT),
    push: true,
    build: "abc1234",
    log: () => {},
  };
  const remoteLog = () =>
    git(dirs.remote, "log", "--format=%an|%s", "main").split("\n");
  const season = () =>
    parseSeasonFile(readFileSync(join(dirs.data, "nfl", "2026.json"), "utf8"));
  return { dirs, world, options, remoteLog, season };
}

describe("runPass", () => {
  it("follows a game from in play to its recap, a commit per change", async () => {
    const { dirs, world, options, remoteLog, season } = setup();
    try {
      // 20:14: in play. The first pass catches up with ESPN; nothing to write.
      let now = Date.parse("2026-10-18T20:14:00Z");
      let report = await runPass(options, now);
      assert.deepEqual(report.commits, []);
      assert.ok(world.espnReads.some((url) => !url.includes("dates=")));
      assert.equal(report.wakeAt, now + MINUTE);

      // 20:15: final, seen a minute later.
      world.status = "final";
      now = Date.parse("2026-10-18T20:15:00Z");
      report = await runPass(options, now);
      assert.deepEqual(report.commits, [
        "track(nfl 2026 W7 SEA@DEN): final, searching",
      ]);
      assert.equal(report.pushed, true);
      assert.equal(season().games[0]!.final_seen_at, "2026-10-18T20:15:00Z");
      assert.ok(report.wakeAt <= now + MINUTE);

      // 20:16: no recap yet; the uploads are read, nothing changes.
      now += MINUTE;
      report = await runPass(options, now);
      assert.deepEqual(report.commits, []);
      assert.ok(world.youtubeReads.includes("playlistItems"));

      // 20:41: the recap is up.
      world.uploads.push(recap);
      world.live.set(recap.youtubeId, recap);
      now = Date.parse("2026-10-18T20:41:00Z");
      report = await runPass(options, now);
      assert.deepEqual(report.commits, [
        `add(nfl 2026 W7 SEA@DEN): 6uFD3NGt0GE "${recap.title}"`,
      ]);
      const game = season().games[0]!;
      assert.equal(game.status, "found");
      assert.equal(
        game.status === "found" && game.detected_at,
        "2026-10-18T20:41:00Z",
      );

      // Pushed, by the publisher, saying which build made each.
      assert.deepEqual(remoteLog(), [
        `Test Publisher|add(nfl 2026 W7 SEA@DEN): 6uFD3NGt0GE "${recap.title}"`,
        "Test Publisher|track(nfl 2026 W7 SEA@DEN): final, searching",
        "A Person|Seed",
      ]);
      assert.match(
        git(dirs.remote, "log", "-1", "--format=%B", "main"),
        /\n\nPublisher: abc1234/,
      );

      // A pass with no news changes no byte.
      const before = readFileSync(join(dirs.data, "nfl", "2026.json"), "utf8");
      report = await runPass(options, now + 30 * MINUTE);
      assert.deepEqual(report.commits, []);
      assert.equal(
        readFileSync(join(dirs.data, "nfl", "2026.json"), "utf8"),
        before,
      );

      const status = readStatus(paths(dirs.data, "nfl").status)!;
      assert.equal(status.lastCommit?.startsWith("add("), true);
      assert.equal(healthy(status, now + 31 * MINUTE), true);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it("sees a person's correction before it writes", async () => {
    const { dirs, world, options, season } = setup();
    try {
      world.status = "final";
      world.uploads.push(recap);
      world.live.set(recap.youtubeId, recap);
      const now = Date.parse("2026-10-18T20:41:00Z");
      await runPass(options, now);
      assert.equal(season().games[0]!.status, "found");

      // A person says the match is wrong, on the remote.
      const other: Video = {
        ...recap,
        youtubeId: "AAAAAAAAAAA",
        title: "Seahawks vs Broncos",
      };
      world.live.set(other.youtubeId, other);
      git(dirs.seed, "pull", "--quiet");
      writeFileSync(
        join(dirs.seed, "nfl", "corrections.json"),
        `${JSON.stringify([{ season: 2026, season_type: "regular", week: 7, away: "SEA", home: "DEN", youtube_id: other.youtubeId, reason: "test" }])}\n`,
      );
      git(dirs.seed, "commit", "--quiet", "-am", "Correct SEA@DEN");
      git(dirs.seed, "push", "--quiet");

      const report = await runPass(options, now + 5 * MINUTE);
      assert.deepEqual(report.commits, [
        "correct(nfl 2026 W7 SEA@DEN): 6uFD3NGt0GE -> AAAAAAAAAAA, reason=test",
      ]);
      assert.ok(world.youtubeReads.includes("videos"));
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it("keeps its commits when the remote is unreachable, and pushes them later", async () => {
    const { dirs, world, options, remoteLog } = setup();
    try {
      git(
        dirs.data,
        "remote",
        "set-url",
        "origin",
        join(dirs.root, "nowhere.git"),
      );
      world.status = "final";
      const report = await runPass(options, Date.parse("2026-10-18T20:15:00Z"));
      assert.equal(report.commits.length, 1);
      assert.equal(report.pushed, false);
      assert.equal(report.unpushed, 1);
      assert.ok(report.errors.some((line) => line.startsWith("pull")));

      git(dirs.data, "remote", "set-url", "origin", dirs.remote);
      git(dirs.data, "fetch", "--quiet");
      const later = await runPass(options, Date.parse("2026-10-18T20:16:00Z"));
      assert.equal(later.pushed, true);
      assert.equal(remoteLog().length, 2);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it("will not write over changes a person left in its checkout", async () => {
    const { dirs, options } = setup();
    try {
      writeFileSync(join(dirs.data, "nfl", "corrections.json"), "[ ]\n");
      await assert.rejects(runPass(options, Date.now()), /not committed/);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it("stops at a conflicting pull, and leaves the checkout as it was", async () => {
    const { dirs } = setup();
    try {
      const repo = new GitRepo(dirs.data, BOT);
      writeFileSync(join(dirs.data, "nfl", "corrections.json"), "[1]\n");
      await repo.commit(["nfl/corrections.json"], "local");
      writeFileSync(join(dirs.seed, "nfl", "corrections.json"), "[2]\n");
      git(dirs.seed, "commit", "--quiet", "-am", "remote");
      git(dirs.seed, "push", "--quiet");
      await assert.rejects(repo.pull(), GitConflictError);
      assert.equal(git(dirs.data, "status", "--porcelain"), "");
      assert.equal(git(dirs.data, "log", "-1", "--format=%s"), "local");
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });
});

describe("runPass, when YouTube or git misbehave", () => {
  it("unlinks a recap only when a second look agrees it is gone", async () => {
    const { dirs, world, options, season } = setup();
    try {
      world.status = "final";
      world.uploads.push(recap);
      world.live.set(recap.youtubeId, recap);
      let now = Date.parse("2026-10-18T20:41:00Z");
      await runPass(options, now);
      await runPass(options, (now += MINUTE)); // the first sweep

      // A week on, the videos endpoint drops the recap once, then has it.
      let calls = 0;
      const flaky = options.youtube;
      const glitchy: PublisherOptions = {
        ...options,
        youtube: () => {
          const client = flaky();
          const videos = client.videos.bind(client);
          client.videos = async (ids) => {
            calls += 1;
            return calls === 1 ? new Map() : videos(ids);
          };
          return client;
        },
      };
      now += 7 * 24 * 60 * MINUTE;
      let report = await runPass(glitchy, now);
      assert.deepEqual(report.commits, []);
      assert.equal(calls, 2);

      // Truly gone, it is unlinked; the window is closed and it was found
      // live, so the game is missing.
      world.live.delete(recap.youtubeId);
      now += 7 * 24 * 60 * MINUTE;
      report = await runPass(options, now);
      assert.deepEqual(report.commits, [
        "remove(nfl 2026 W7 SEA@DEN): reason=taken-down",
      ]);
      assert.equal(season().games[0]!.status, "missing");
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it("puts the file back when a commit fails, so the next pass can run", async () => {
    const { dirs, world, options } = setup();
    try {
      world.status = "final";
      const repo = new GitRepo(dirs.data, BOT);
      const failing: PublisherOptions = {
        ...options,
        git: Object.assign(Object.create(repo) as GitRepo, {
          commit: async () => {
            throw new Error("disk full");
          },
          pull: () => repo.pull(),
          dirty: (paths: readonly string[]) => repo.dirty(paths),
          discard: (paths: readonly string[]) => repo.discard(paths),
        }),
      };
      await assert.rejects(
        runPass(failing, Date.parse("2026-10-18T20:15:00Z")),
        /disk full/,
      );
      assert.equal(git(dirs.data, "status", "--porcelain"), "");
      const report = await runPass(options, Date.parse("2026-10-18T20:16:00Z"));
      assert.deepEqual(report.commits, [
        "track(nfl 2026 W7 SEA@DEN): final, searching",
      ]);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });
});

describe("acquireLock", () => {
  it("lets one publisher hold a checkout, and takes over a dead one's lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "lock-"));
    try {
      const path = join(dir, "publisher.lock");
      writeFileSync(path, "999999999");
      const release = acquireLock(path);
      assert.equal(readFileSync(path, "utf8"), String(process.pid));
      writeFileSync(path, "1");
      assert.throws(() => acquireLock(path), /Another publisher/);
      writeFileSync(path, String(process.pid));
      release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("seasonOf", () => {
  it("counts February's Super Bowl in the season before", () => {
    assert.equal(seasonOf(Date.parse("2027-02-14T00:00:00Z")), 2026);
    assert.equal(seasonOf(Date.parse("2027-03-01T00:00:00Z")), 2027);
    assert.equal(seasonOf(Date.parse("2026-10-18T00:00:00Z")), 2026);
  });
});
