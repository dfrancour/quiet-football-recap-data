// Checks every season file for what the schema cannot say: it points at its
// schema, its name and every game match its season, games are in order, no
// team plays twice in a week, no source's id names two games, and the file is
// written exactly as the publisher writes it, so a commit only ever shows a
// real change. The shape itself is the schema's job (scripts/validate.mjs).
//
//   node scripts/check.mjs

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../nfl/", import.meta.url).pathname;
const problems = [];

/** Season types in the order games are sorted. */
const TYPES = ["preseason", "regular", "postseason"];

/** The order the publisher writes a game's keys in. */
const GAME_KEYS = [
  "season",
  "season_type",
  "week",
  "away",
  "home",
  "external_ids",
  "kickoff",
  "status",
  "final_seen_at",
  "video",
  "detected_at",
];
const VIDEO_KEYS = ["youtube_id", "title", "published_at"];

function inOrder(keys, order) {
  const at = keys.map((key) => order.indexOf(key));
  return at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1]));
}

for (const name of readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f))) {
  const text = readFileSync(join(dir, name), "utf8");
  const file = JSON.parse(text);
  const where = (game) =>
    `${name}: ${game.season_type === "preseason" ? "PRE " : ""}W${game.week} ${game.away}@${game.home}`;

  if (file.$schema !== "./schema.json") {
    problems.push(`${name}: $schema is ${file.$schema}, not ./schema.json`);
  }

  if (`${file.season}.json` !== name) {
    problems.push(`${name}: holds season ${file.season}`);
  }

  if (text !== `${JSON.stringify(file, null, 2)}\n`) {
    problems.push(
      `${name}: not in canonical form (2-space JSON, final newline)`,
    );
  }

  const seen = new Set();
  const sourceIds = new Set();
  file.games.forEach((game, i) => {
    if (
      !inOrder(Object.keys(game), GAME_KEYS) ||
      (game.video && !inOrder(Object.keys(game.video), VIDEO_KEYS))
    ) {
      problems.push(`${where(game)}: keys out of order`);
    }
    const ids = Object.keys(game.external_ids ?? {});
    if (ids.join() !== [...ids].sort().join()) {
      problems.push(`${where(game)}: external ids out of order`);
    }
    for (const [source, id] of Object.entries(game.external_ids ?? {})) {
      const key = `${source} ${id}`;
      if (sourceIds.has(key))
        problems.push(`${where(game)}: ${key} names two games`);
      sourceIds.add(key);
    }
    if (game.season !== file.season)
      problems.push(`${where(game)}: season ${game.season}`);
    if (game.away === game.home) problems.push(`${where(game)}: plays itself`);
    for (const team of [game.away, game.home]) {
      const key = `${game.season_type} ${game.week} ${team}`;
      if (seen.has(key))
        problems.push(`${where(game)}: ${team} twice in a week`);
      seen.add(key);
    }

    const before = file.games[i - 1];
    if (before && compare(before, game) >= 0) {
      problems.push(`${where(game)}: out of order after ${where(before)}`);
    }
  });
}

function compare(a, b) {
  return (
    TYPES.indexOf(a.season_type) - TYPES.indexOf(b.season_type) ||
    a.week - b.week ||
    a.kickoff.localeCompare(b.kickoff) ||
    a.home.localeCompare(b.home)
  );
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("ok");
