// Validates every season file against its league's schema.
//
//   npm ci && node scripts/validate.mjs

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = new URL("../", import.meta.url).pathname;
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

let failed = false;
for (const league of ["nfl"]) {
  const dir = join(root, league);
  const schema = JSON.parse(readFileSync(join(dir, "schema.json"), "utf8"));
  const validate = ajv.compile(schema);
  for (const name of readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f))) {
    const file = JSON.parse(readFileSync(join(dir, name), "utf8"));
    if (validate(file)) continue;
    failed = true;
    for (const error of validate.errors ?? []) {
      console.error(`${league}/${name}${error.instancePath}: ${error.message}`);
    }
  }
}

if (failed) process.exit(1);
console.log("ok");
