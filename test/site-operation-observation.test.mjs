import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

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

async function httpFixture(t, handler) {
  const calls = [];
  const server = createServer((request, response) => {
    calls.push({ method: request.method, url: request.url, acceptEncoding: request.headers["accept-encoding"] });
    handler(request, response);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { url: `http://127.0.0.1:${server.address().port}/`, calls };
}

test("identity content coding is negotiated on the native HTTP wire only when selected", async t => {
  const html = '<html><head><link rel="canonical" href="/"></head><body>Identity representation</body></html>';
  const { url, calls } = await httpFixture(t, (request, response) => {
    const identity = request.headers["accept-encoding"] === "identity";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", ...(identity ? {} : { "content-encoding": "gzip" }) });
    response.end(identity ? html : gzipSync(html));
  });
  const request = { endpoint: "native-fixture", url, responseType: "text" };
  const selected = await observeSiteOperation(request, { identityContentCoding: true, safeErrors: true });
  assert.equal(calls[0].acceptEncoding, "identity");
  assert.equal(selected.status, "witness");
  assert.equal(selected.httpStatus, 200);
  assert.equal(selected.body, html);
  assert.equal(selected.bodyTruncated, false);
  assert.equal(selected.headers["content-encoding"], undefined);
  const ordinary = await observeSiteOperation(request);
  assert.notEqual(calls[1].acceptEncoding, "identity");
  assert.equal(ordinary.status, "witness");
  assert.equal(ordinary.headers["content-encoding"], "gzip");
  assert.equal(ordinary.body, html);
  assert.equal(calls.length, 2);
});

test("a native server that ignores identity negotiation remains an unread representation", async t => {
  const { url, calls } = await httpFixture(t, (_request, response) => {
    response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
    response.end(gzipSync('<meta name="robots" content="noindex">'));
  });
  const result = await observeSiteOperation({ endpoint: "native-fixture", url, responseType: "text" },
    { identityContentCoding: true, safeErrors: true });
  assert.deepEqual(calls, [{ method: "GET", url: "/", acceptEncoding: "identity" }]);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.headers["content-encoding"], "gzip");
  assert.equal(result.status, "obstruction");
  assert.equal(result.reason, "response-representation-unread");
  assert.equal(result.bodyTruncated, true);
  assert.equal(Object.hasOwn(result, "body"), false);
});

test("a native server refusing identity negotiation retains its HTTP refusal without retry", async t => {
  const { url, calls } = await httpFixture(t, (_request, response) => {
    response.writeHead(406, { "content-type": "text/plain" });
    response.end("Identity representation unavailable");
  });
  const result = await observeSiteOperation({ endpoint: "native-fixture", url, responseType: "text" },
    { identityContentCoding: true, safeErrors: true });
  assert.deepEqual(calls, [{ method: "GET", url: "/", acceptEncoding: "identity" }]);
  assert.equal(result.httpStatus, 406);
  assert.equal(result.status, "obstruction");
  assert.equal(result.reason, "HTTP 406");
  assert.equal(result.body, "Identity representation unavailable");
});
