import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { projectSiteConformance } from "../src/site-conformance.mjs";

const now = "2026-10-25T22:00:00Z", url = "https://site.example/article";
const context = { policyRevision: "policy-1", sourceRevision: "source-1" };
const route = (changes = {}) => ({ url, method: "GET", intent: "index", ...changes });
const observation = (changes = {}) => ({ id: "probe-1", url, method: "GET", observedAt: now, httpStatus: 200, status: "witness", headers: { "content-type": "text/html" }, body: "<!doctype html><head><title>Article</title></head><body>Article</body>", ...changes });
const input = (changes = {}) => ({ site: "site.example", owner: "site-owner", sourceContext: context, evaluatedAt: now, routes: [route()], observations: [observation()], ...changes });
const codes = (report) => report.findings.map((finding) => finding.code);

test("the declared exact route passes raw-response checks without claiming Google indexing", () => {
  const report = projectSiteConformance(input());
  assert.equal(report.complete, true);
  assert.deepEqual(report.scope.routes, [{ url, method: "GET" }]);
  assert.ok(report.scope.excludes.includes("proof of Google indexing"));
  assert.deepEqual(report.sourceContext, context);
});

test("HEAD, a neighboring path, and yesterday's response cannot witness today's GET", () => {
  for (const changes of [{ method: "HEAD" }, { url: "https://site.example/" }]) {
    assert.deepEqual(codes(projectSiteConformance(input({ observations: [observation(changes)] }))), ["observation-missing"]);
  }
  const stale = projectSiteConformance(input({ maxAgeMs: 1, observations: [observation({ observedAt: "2026-10-24T22:00:00Z" })] }));
  assert.deepEqual(codes(stale), ["observation-stale"]);
  assert.equal(stale.findings[0].action, "investigate");
});

test("current HTTP contradictions become stable, evidence-bound repair findings", () => {
  const first = projectSiteConformance(input({ observations: [observation({ httpStatus: 503, status: "obstruction" })] }));
  const second = projectSiteConformance(input({ observations: [observation({ id: "next-probe", httpStatus: 503, status: "obstruction" })] }));
  assert.equal(first.findings[0].id, second.findings[0].id);
  assert.equal(first.findings[0].action, "repair");
  assert.equal(first.findings[0].observed, 503);
  assert.deepEqual(first.findings[0].sourceContext, context);
  assert.equal(second.findings[0].evidence[0].id, "next-probe");
});

test("transport absence, future evidence, revision mismatch and same-time conflict remain unknown", () => {
  const cases = [
    [input({ observations: [observation({ httpStatus: null, status: "obstruction", reason: "offline" })] }), "http-response-unobserved"],
    [input({ observations: [observation({ observedAt: "2026-10-26T22:00:00Z" })] }), "observation-in-future"],
    [input({ sourceContext: { ...context, deploymentRevision: "release-2" } }), "deployment-revision-unbound"],
    [input({ observations: [observation(), observation({ id: "probe-2", httpStatus: 503 })] }), "observation-conflict"],
  ];
  for (const [snapshot, code] of cases) {
    const report = projectSiteConformance(snapshot);
    assert.deepEqual(codes(report), [code]);
    assert.equal(report.findings[0].status, "unknown");
    assert.equal(report.findings[0].action, "investigate");
  }
});

test("an explicitly excluded not-yet-open 503 route is not automatically ordered open", () => {
  const report = projectSiteConformance(input({ routes: [route({ intent: "exclude", expectedStatusCodes: [503] })], observations: [observation({ httpStatus: 503 })] }));
  assert.equal(report.complete, true);
  assert.throws(() => projectSiteConformance(input({ routes: [route({ expectedStatusCodes: [503] })] })), /contradict/);
});

test("intentional exclusions and alternate canonicals stay expected", () => {
  const snapshots = [
    input({ routes: [route({ intent: "exclude" })], observations: [observation({ body: '<meta content="noindex" name="robots">' })], searchConsole: [{ id: "gsc-1", property: "sc-domain:site.example", url, observedAt: now, reason: "Excluded by ‘noindex’ tag" }] }),
    input({ routes: [route({ intent: "alternate", canonicalUrl: "https://site.example/canonical" })], observations: [observation({ body: '<link href="/canonical" rel="canonical">' })], searchConsole: [{ id: "gsc-2", property: "sc-domain:site.example", url, observedAt: now, reason: "Alternate page with proper canonical tag" }] }),
    input({ routes: [route({ intent: "gone" })], observations: [observation({ httpStatus: 404 })], searchConsole: [{ id: "gsc-3", property: "sc-domain:site.example", url, observedAt: now, reason: "Not found (404)" }] }),
  ];
  for (const snapshot of snapshots) assert.equal(projectSiteConformance(snapshot).complete, true);
});

test("actual noindex on an index-intended route is distinguished from comments and other bots", () => {
  for (const body of ['<META CONTENT="noindex,follow" NAME="ROBOTS">', '<meta name=googlebot content=noindex>', '<meta name="robots" content="none">']) {
    const report = projectSiteConformance(input({ observations: [observation({ body })] }));
    assert.deepEqual(codes(report), ["indexing-directive"]);
    assert.equal(report.findings[0].action, "repair");
  }
  const report = projectSiteConformance(input({ observations: [observation({ headers: { "content-type": "text/html", "x-robots-tag": "googlebot: index, otherbot: noindex" }, body: '<!-- <meta name="robots" content="noindex"> --><script>"<meta name=robots content=noindex>"</script><main>Article</main>' })] }));
  assert.equal(report.complete, true);
});

test("canonical overlap contradictions are retained and followed redirects cannot substitute targets", () => {
  const canonical = projectSiteConformance(input({ routes: [route({ canonicalUrl: url })], observations: [observation({ body: '<link rel="canonical" href="/wrong">' })] }));
  assert.equal(canonical.findings[0].code, "canonical-target");
  assert.equal(canonical.findings[0].action, "repair");
  const followed = projectSiteConformance(input({ observations: [observation({ redirected: true, finalUrl: "https://site.example/different" })] }));
  assert.deepEqual(codes(followed), ["redirect-source-unobserved"]);
  const redirect = projectSiteConformance(input({ routes: [route({ intent: "redirect", canonicalUrl: "https://site.example/destination" })], observations: [observation({ httpStatus: 301, headers: { location: "/destination" } })] }));
  assert.equal(redirect.complete, true);
});

test("domain-level Google mail does not become an invented affected URL or cause", () => {
  const report = projectSiteConformance(input({ searchConsole: [{ id: "mail-1", property: "sc-domain:site.example", observedAt: now, reason: "Blocked by robots.txt" }] }));
  assert.deepEqual(codes(report), ["search-console-url-unbound:robots"]);
  assert.equal(report.findings[0].url, null);
  assert.equal(report.findings[0].action, "investigate");
  assert.equal(report.findings[0].evidence[0].id, "mail-1");
  assert.equal(report.complete, false);
});

test("a successful public response cannot close an unresolved Google indexing report", () => {
  const report = projectSiteConformance(input({ searchConsole: [{ id: "gsc-5xx", property: "sc-domain:site.example", url, observedAt: now, reason: "Server error (5xx)" }] }));
  assert.equal(report.records[0].status, "conformant");
  assert.deepEqual(codes(report), ["search-console-unresolved:server-error"]);
  assert.equal(report.complete, false);
});

test("empty coverage, missing policy, unknown intent and truncated HTML cannot pass", () => {
  assert.deepEqual(codes(projectSiteConformance(input({ routes: [], observations: [] }))), ["route-cover-empty"]);
  assert.throws(() => projectSiteConformance(input({ sourceContext: {} })), /policyRevision/);
  assert.deepEqual(codes(projectSiteConformance(input({ routes: [route({ intent: "unknown", expectedStatusCodes: [200] })] }))), ["route-intent-unbound"]);
  assert.deepEqual(codes(projectSiteConformance(input({ observations: [observation({ bodyTruncated: true })] }))), ["indexing-directive"]);
});

test("existing CLI projects supplied evidence without fetching and reports incomplete scope", () => {
  const snapshot = input({ observations: [] }), expected = projectSiteConformance(snapshot);
  const cli = fileURLToPath(new URL("../scripts/observe-site-operation.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "--conformance"], { input: JSON.stringify(snapshot), encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), expected);
});

test("provider dispositions retain primary evidence even when exclusion is expected", () => {
  const report = projectSiteConformance(input({ routes: [route({ intent: "exclude" })], observations: [observation({ body: '<meta name="robots" content="noindex">' })], searchConsole: [{ id: "mail-expected", property: "sc-domain:site.example", url, observedAt: now, reason: "Excluded by noindex tag" }] }));
  assert.equal(report.complete, true);
  assert.equal(report.providerNotices[0].classification, "expected");
  assert.equal(report.providerNotices[0].evidence[0].id, "mail-expected");
});

test("encoded noindex and parameterized robot headers cannot create a false pass", () => {
  for (const change of [{ body: '<meta name="robots" content="no&#105;ndex">' }, { headers: { "content-type": "text/html", "x-robots-tag": "max-snippet:0, noindex" } }, { body: '<meta name="robots" content="noindex" content="index">' }]) {
    const report = projectSiteConformance(input({ observations: [observation(change)] }));
    assert.equal(report.findings[0].action, "repair");
    assert.equal(report.findings[0].code, "indexing-directive");
  }
  const malformed = projectSiteConformance(input({ observations: [observation({ body: '<meta name="robots" content="unknown' })] }));
  assert.equal(malformed.findings[0].status, "unknown");
});

test("excluded HTTP 200 requires evidence instead of assuming the declared exclusion works", () => {
  const report = projectSiteConformance(input({ routes: [route({ intent: "exclude" })] }));
  assert.equal(report.complete, false);
  assert.deepEqual(codes(report), ["exclusion-directive"]);
  assert.equal(report.findings[0].action, "investigate");
});

test("site origins and provider property scopes cannot be substituted", () => {
  assert.throws(() => projectSiteConformance(input({ routes: [route({ url: "https://foreign.example/article" })] })), /exact HTTP origin/);
  for (const property of ["sc-domain:foreign.example", "https://site.example/other/"]) {
    const report = projectSiteConformance(input({ searchConsole: [{ id: "wrong-property", property, url, observedAt: now, reason: "Server error (5xx)" }] }));
    assert.deepEqual(codes(report), ["search-console-property-mismatch:server-error"]);
    assert.equal(report.findings[0].url, null);
    assert.equal(report.providerNotices[0].classification, "unbound");
  }
  const report = projectSiteConformance(input({ searchConsole: [{ id: "prefix-property", property: "https://site.example/", url, observedAt: now, reason: "Server error (5xx)" }] }));
  assert.deepEqual(codes(report), ["search-console-unresolved:server-error"]);
});

test("route, observation, provider notice, and body budgets are explicit admission bounds", () => {
  assert.throws(() => projectSiteConformance(input({ routes: Array(129).fill(route()) })), /routes exceeds/);
  assert.throws(() => projectSiteConformance(input({ observations: Array(1025).fill(observation()) })), /observations exceeds/);
  assert.throws(() => projectSiteConformance(input({ searchConsole: Array(257).fill({}) })), /searchConsole exceeds/);
  assert.throws(() => projectSiteConformance(input({ observations: [observation({ body: "x".repeat(2097153) })] })), /body exceeds/);
});

test("uncovered provider URLs remain evidence and cannot extend the site's declared origin", () => {
  const url = "https://other.site.example/page";
  const report = projectSiteConformance(input({ searchConsole: [{ id: "subdomain-google", property: "sc-domain:site.example", url, observedAt: now, reason: "Server error (5xx)" }] }));
  assert.equal(report.findings[0].url, null);
  assert.equal(report.findings[0].observed.url, url);
  assert.equal(report.findings[0].evidence[0].url, url);
  assert.equal(report.findings[0].action, "investigate");
});

test("a matching canonical header cannot conceal uninspected or truncated HTML overlap", () => {
  const routes = [route({ intent: "alternate", canonicalUrl: "https://site.example/canonical" })];
  const headers = { "content-type": "text/html", link: '<https://site.example/canonical>; rel="canonical"' };
  for (const change of [{ bodyTruncated: true }, { body: undefined }, { body: '<link rel="canonical" href="/unfinished' }]) {
    const report = projectSiteConformance(input({ routes, observations: [observation({ headers, ...change })] }));
    assert.equal(report.complete, false);
    assert.deepEqual(codes(report), ["canonical-target"]);
    assert.equal(report.findings[0].status, "unknown");
  }
  const contradiction = projectSiteConformance(input({ routes, observations: [observation({ headers: { ...headers, link: '<https://site.example/wrong>; rel="canonical"' }, bodyTruncated: true })] }));
  assert.equal(contradiction.findings[0].status, "nonconformant");
  const complete = projectSiteConformance(input({ routes, observations: [observation({ headers })] }));
  assert.equal(complete.complete, true);
});
