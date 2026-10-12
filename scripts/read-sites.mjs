#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readSiteAdministration } from "../src/site-administration.mjs";

export { readSiteAdministration };

if (import.meta.main) {
  const { values } = parseArgs({ options: { root: { type: "string", default: process.cwd() }, focus: { type: "string" } } });
  process.stdout.write(`${JSON.stringify(readSiteAdministration(values.root, { focus: values.focus }))}\n`);
}
