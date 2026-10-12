#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { observeSiteOperation } from "../src/site-operation-observation.mjs";
export { observeSiteOperation };
if (import.meta.main) process.stdout.write(`${JSON.stringify(await observeSiteOperation(JSON.parse(readFileSync(0, "utf8"))))}\n`);
