import assert from "node:assert/strict";
import test from "node:test";
import { projectSiteAdministration } from "../src/site-administration.mjs";

test("projects explicit site administration candidates", () => {
  const result = projectSiteAdministration([{
    name: "ops.561.group",
    path: "sites/ops.561.group",
    manifest: { name: "@561-group/ops", scripts: { serve: "node server.mjs" } },
    configuration: { endpoints: { "ops.561.group": { port: 18805, operations: ["/health"] } } },
  }]);
  assert.equal(result.packages.length, 1);
  assert.equal(result.packages[0].endpoints[0].localUrl, "http://127.0.0.1:18805");
  assert.equal(result.packages[0].endpoints[0].operations[0].path, "/health");
});

test("focus is an exact normalized site selector", () => {
  const result = projectSiteAdministration([{
    name: "one", path: "sites/one", manifest: { name: "one" },
    configuration: { endpoints: { "one.example": {} } },
  }], { focus: "https://one.example/" });
  assert.equal(result.packages.length, 1);
});

test("administration retains HEAD and HTML observation declarations", () => {
  const result = projectSiteAdministration([{ name: "site", path: "site", manifest: { name: "site" }, configuration: { endpoints: { "site.example": { operations: [{ path: "/article", method: "HEAD", responseType: "none" }] } } } }]);
  assert.equal(result.packages[0].endpoints[0].operations[0].method, "HEAD");
  assert.equal(result.packages[0].endpoints[0].operations[0].responseType, "none");
});
