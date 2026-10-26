import assert from "node:assert/strict";
import test from "node:test";

import { observeSiteOperation, projectSiteOperationRequests } from "../src/site-operation-observation.mjs";

test("projects configured endpoints into individual HTTP requests", () => {
  const requests = projectSiteOperationRequests({ packages: [{ endpoints: [{ name: "ops.example", localUrl: "http://127.0.0.1:9", publicUrl: "https://ops.example/", operations: [{ path: "/health", method: "GET", body: null, timeoutMs: 30 }] }] }] });
  assert.deepEqual(requests, [{ kind: "website-administration.operation-request", endpoint: "ops.example", url: "http://127.0.0.1:9/health", method: "GET", body: null, timeoutMs: 30 }]);
});

test("observes exactly one request and retains failures as obstructions", async () => {
  const request = { endpoint: "ops.example", url: "https://ops.example/health", method: "GET", timeoutMs: 30 };
  const witness = await observeSiteOperation(request, { fetchImpl: async () => ({ ok: true, json: async () => ({ status: "ok" }) }) });
  assert.deepEqual(witness.body, { status: "ok" });
  const obstruction = await observeSiteOperation(request, { fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(obstruction.status, "obstruction");
  assert.equal(obstruction.reason, "offline");
});

test("public projection preserves one slash, exact query, and HEAD", () => {
  const administration = { packages: [{ endpoints: [{ name: "site.example", localUrl: "http://127.0.0.1:9", publicUrl: "https://site.example/", operations: [{ path: "/table-1?mode=public", method: "HEAD", responseType: "none" }] }] }] };
  const [request] = projectSiteOperationRequests(administration, { target: "public" });
  assert.equal(request.url, "https://site.example/table-1?mode=public");
  assert.equal(request.method, "HEAD");
  assert.equal(request.responseType, "none");
});

test("unsupported methods are refused before a request can be changed or sent", async () => {
  let called = false;
  await assert.rejects(observeSiteOperation({ endpoint: "site.example", url: "https://site.example/", method: "DELETE" }, { fetchImpl: async () => { called = true; } }), /method/);
  assert.equal(called, false);
});

test("HTTP failure and HTML metadata survive observation, without response cookies", async () => {
  const request = { endpoint: "site.example", url: "https://site.example/table-1", method: "GET", responseType: "text" };
  let actual;
  const result = await observeSiteOperation(request, { clock: () => "2026-10-25T22:00:00Z", fetchImpl: async (url, options) => {
    actual = { url, options };
    return new Response('<meta name="robots" content="noindex"><main>Not open</main>', { status: 503, headers: { "content-type": "text/html", "x-deployment-revision": "release-1", "set-cookie": "private=value" } });
  } });
  assert.equal(actual.options.redirect, "manual");
  assert.equal(result.httpStatus, 503);
  assert.equal(result.method, "GET");
  assert.equal(result.url, request.url);
  assert.equal(result.deploymentRevision, "release-1");
  assert.equal(result.observedAt, "2026-10-25T22:00:00Z");
  assert.equal(result.headers["set-cookie"], undefined);
  assert.match(result.body, /Not open/);
  assert.equal(result.reason, "HTTP 503");
});

test("redirect source and bounded response failures retain HTTP evidence", async () => {
  const request = { endpoint: "site.example", url: "https://site.example/old", method: "GET", responseType: "text" };
  const redirect = await observeSiteOperation(request, { fetchImpl: async () => new Response(null, { status: 301, headers: { location: "/new" } }) });
  assert.equal(redirect.httpStatus, 301);
  assert.equal(redirect.headers.location, "/new");
  const large = await observeSiteOperation({ ...request, maxBodyBytes: 3 }, { fetchImpl: async () => new Response("long body", { status: 200 }) });
  assert.equal(large.httpStatus, 200);
  assert.equal(large.bodyTruncated, true);
  assert.equal(large.reason, "response-body-limit");
});

test("HEAD does not parse an absent body, and POST remains explicit", async () => {
  let seen;
  const head = await observeSiteOperation({ endpoint: "site.example", url: "https://site.example/", method: "HEAD" }, { fetchImpl: async (_url, options) => { seen = options; return new Response(null); } });
  assert.equal(seen.method, "HEAD");
  assert.equal(head.status, "witness");
  const post = await observeSiteOperation({ endpoint: "ops.example", url: "https://ops.example/probe", method: "POST", body: { check: true } }, { fetchImpl: async (_url, options) => { seen = options; return Response.json({ ok: true }); } });
  assert.equal(seen.method, "POST");
  assert.deepEqual(JSON.parse(seen.body), { check: true });
  assert.deepEqual(post.body, { ok: true });
});
