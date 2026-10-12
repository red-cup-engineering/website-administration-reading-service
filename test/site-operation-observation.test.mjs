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
