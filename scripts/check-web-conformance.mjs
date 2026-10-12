#!/usr/bin/env node
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { readWebConformance } from "../src/web-conformance.mjs";
export { readWebConformance };
if (import.meta.main) {
  const { values } = parseArgs({ options: { root: { type: "string", default: process.cwd() }, output: { type: "string" }, migrations: { type: "string" } } });
  const result = readWebConformance(values.root);
  const body = `${JSON.stringify(result, null, 2)}\n`;
  if (values.output) { writeFileSync(values.output, body); process.stdout.write(`${JSON.stringify(result.summary)}\n`); }
  else process.stdout.write(body);
  if (values.migrations) writeFileSync(values.migrations, `${JSON.stringify(result.migrations, null, 2)}\n`);
  process.exitCode = result.complete ? 0 : result.issues.length ? 2 : 1;
}
