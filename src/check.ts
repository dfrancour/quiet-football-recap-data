/**
 * Checks every league's files, as CI does on every push:
 *
 *   node src/check.ts
 *
 * A season file must pass its league's schema, and then be exactly what the
 * publisher would write for it (`serializeSeasonFile`): keys in order, games
 * sorted, 2-space JSON with a final newline. So the format is defined once,
 * in src/dataset.ts and the schema, and a commit only ever shows a real
 * change. Beyond that, it checks what neither can say: the file's name and
 * every game match its season, no team plays itself or twice in a week, no
 * source's id names two games, and the schema's teams are the league's.
 * The corrections a person keeps must name known teams, one per game.
 *
 * Apart from src/cli.ts because it needs the dev dependencies (Ajv) that the
 * publisher's image leaves out.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { correctionsSchema } from "./corrections.ts";
import {
  compareGames,
  gameKey,
  gameName,
  parseSeasonFile,
  serializeSeasonFile,
  type SeasonFile,
} from "./dataset.ts";
import { NFL } from "./leagues/nfl.ts";
import type { League } from "./model.ts";

const LEAGUES: readonly League[] = [NFL];

const ROOT = new URL("../", import.meta.url).pathname;

// ajv-formats is CommonJS: its plugin is the module's default export.
const addFormats = addFormatsModule.default;

function checkLeague(league: League): string[] {
  const dir = join(ROOT, league.id);
  const problems: string[] = [];
  const codes = new Set(league.teams.map((team) => team.abbreviation));

  const schema = JSON.parse(readFileSync(join(dir, "schema.json"), "utf8"));
  const schemaTeams: unknown = schema.$defs?.team?.enum;
  if (
    !Array.isArray(schemaTeams) ||
    [...schemaTeams].sort().join() !== [...codes].sort().join()
  ) {
    problems.push(
      `${league.id}/schema.json: its teams are not src/leagues/${league.id}.ts's`,
    );
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const names = readdirSync(dir).filter((name) => /^\d{4}\.json$/.test(name));
  for (const name of names) {
    const where = `${league.id}/${name}`;
    const text = readFileSync(join(dir, name), "utf8");
    if (!validate(JSON.parse(text))) {
      for (const error of validate.errors ?? []) {
        problems.push(`${where}${error.instancePath}: ${error.message}`);
      }
      continue;
    }
    const file = parseSeasonFile(text);
    if (`${file.season}.json` !== name) {
      problems.push(`${where}: holds season ${file.season}`);
    }
    const written = serializeSeasonFile(file);
    if (text !== written) {
      problems.push(
        `${where}: not as the publisher writes it, ${firstDifference(text, written)}`,
      );
    }
    problems.push(...checkGames(league, where, file));
  }

  const corrections = correctionsSchema.safeParse(
    JSON.parse(readFileSync(join(dir, "corrections.json"), "utf8")),
  );
  if (!corrections.success) {
    problems.push(
      `${league.id}/corrections.json: ${corrections.error.message}`,
    );
  } else {
    const seen = new Set<string>();
    for (const entry of corrections.data) {
      const key = `${entry.season} ${gameKey(entry)}`;
      const where = `${league.id}/corrections.json: ${key}`;
      for (const team of [entry.away, entry.home]) {
        if (!codes.has(team)) problems.push(`${where}: no team ${team}`);
      }
      if (seen.has(key)) problems.push(`${where}: corrected twice`);
      seen.add(key);
    }
  }
  return problems;
}

function checkGames(league: League, where: string, file: SeasonFile): string[] {
  const problems: string[] = [];
  const weeks = new Set<string>();
  const sourceIds = new Set<string>();
  file.games.forEach((game, i) => {
    const at = `${where}: ${gameName(league.id, game)}`;
    const before = file.games[i - 1];
    if (before && compareGames(before, game) >= 0) {
      problems.push(`${at}: out of order after ${gameName(league.id, before)}`);
    }
    if (game.season !== file.season)
      problems.push(`${at}: season ${game.season}`);
    if (game.away === game.home) problems.push(`${at}: plays itself`);
    for (const team of [game.away, game.home]) {
      const key = `${game.season_type} ${game.week} ${team}`;
      if (weeks.has(key)) problems.push(`${at}: ${team} twice in a week`);
      weeks.add(key);
    }
    for (const [source, id] of Object.entries(game.external_ids)) {
      const key = `${source} ${id}`;
      if (sourceIds.has(key)) problems.push(`${at}: ${key} names two games`);
      sourceIds.add(key);
    }
  });
  return problems;
}

/** Where two texts first differ: "line 12: … (expected …)". */
function firstDifference(actual: string, expected: string): string {
  if (`${actual}\n` === expected) return "no final newline";
  const a = actual.split("\n");
  const b = expected.split("\n");
  const at = Math.max(a.length, b.length);
  const line = Array.from({ length: at }, (_, i) => i).find(
    (i) => a[i] !== b[i],
  )!;
  const show = (text: string | undefined) =>
    text === undefined ? "the end" : JSON.stringify(text);
  return `line ${line + 1}: ${show(a[line])} (expected ${show(b[line])})`;
}

const problems = LEAGUES.flatMap(checkLeague);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("ok");
