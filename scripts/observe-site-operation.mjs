#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { observeSiteOperation } from "../src/site-operation-observation.mjs";
import { projectSiteConformance } from "../src/site-conformance.mjs";
export { observeSiteOperation, projectSiteConformance };
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && args[0] !== "--conformance") throw new TypeError("only --conformance is supported");
  const input = JSON.parse(readFileSync(0, "utf8"));
  const result = args[0] === "--conformance" ? projectSiteConformance(input) : await observeSiteOperation(input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (args[0] === "--conformance") process.exitCode = result.complete ? 0 : result.findings.some((finding) => finding.action === "repair") ? 2 : 1;
}
