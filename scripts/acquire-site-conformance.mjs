#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {acquireSiteConformance} from '../src/site-conformance-acquisition.mjs';

// The selected file is installed source policy. Standard input is evidence,
// never a network destination list or credential/configuration channel.
if (import.meta.main) {
  const [policyPath,...extra] = process.argv.slice(2);
  if (!policyPath || extra.length) throw new TypeError('usage: acquire-site-conformance installed-policy.json < evidence.json');
  const policy = JSON.parse(await readFile(policyPath,'utf8'));
  const input = JSON.parse(readFileSync(0,'utf8'));
  const report = await acquireSiteConformance(policy,input);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.complete ? 0 : report.findings.some(value => value.action === 'repair') ? 2 : 1;
}
