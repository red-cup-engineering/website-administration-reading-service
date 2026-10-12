import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectWebSource, TUFTE, SERVER, PLATFORM } from "../src/web-source-evidence.mjs";
import { projectWebConformance, readWebSourceSnapshot, readWebConformance } from "../src/web-conformance.mjs";
import { readSiteAdministration } from "../src/site-administration.mjs";
const report = (entries) => projectWebConformance({ root: "/fixture", issues: [], files: Object.entries(entries).map(([path, text]) => ({ path, text })) });
const manifest = (name, rest = {}) => JSON.stringify({ name, ...rest });
const row = (result, name) => result.records.find((entry) => entry.path === name);

test("nested independent service packages retain nearest owner", () => {
  const result = report({ "lib/services/a/package.json": manifest("a"), "lib/services/a/sites/b/package.json": manifest("b"), "lib/services/a/sites/b/index.html": "<!doctype html><main>Hello</main>" });
  assert.equal(row(result, "lib/services/a/sites/b/index.html").package, "b");
  assert.equal(result.complete, false);
});
test("package dependency and dead import do not establish renderer use", () => {
  const result = report({ "package.json": manifest("a", { dependencies: { [TUFTE]: "1.0.0" } }), "page.mjs": `import { renderTufteDocument } from '${TUFTE}'; export const page = '<main>Hello</main>';` });
  assert.equal(row(result, "page.mjs").frontendConformance.status, "nonconformant");
});
test("renderer call aliases are recognized; styles alone cannot pass", () => {
  const source = inspectWebSource({ path: "page.mjs", text: `import { renderTufteDocument as render, renderTufteStyles } from '${TUFTE}'; render({}); renderTufteStyles();` });
  assert.equal(source.signals.filter((s) => s.kind === "tufte-render-call").length, 1);
});
test("comment and string import lookalikes are not execution", () => {
  const source = inspectWebSource({ path: "a.mjs", text: `// import { renderTufteDocument } from '${TUFTE}'; renderTufteDocument({});\nconst code = "http.createServer()";` });
  assert.equal(source.signals.length, 0);
});
test("direct engine construction passes, competing native transport remains unresolved migration", () => {
  const result = report({ "package.json": manifest("a"), "ok.mjs": `import { createWebServer } from '${SERVER}'; export const handler = createWebServer({});`, "bad.cjs": "const { createServer: serve } = require('node:http'); serve(() => {});" });
  assert.equal(row(result, "ok.mjs").serverConformance.status, "conformant");
  assert.equal(row(result, "bad.cjs").serverConformance.status, "nonconformant");
});
test("standalone Python, Deno, and visible examples stay in scope", () => {
  const result = report({ "legacy/server.py": "from http.server import HTTPServer\nHTTPServer(('', 8000), Handler).serve_forever()", "private/worker.ts": "Deno.serve(req => new Response('ok'));", "examples/index.html": "<main>Visible</main>" });
  assert.equal(result.summary.serverRecords, 2);
  assert.equal(row(result, "examples/index.html").classification, "visible-development-frontend");
  assert.equal(result.summary.byStatus.nonconformant, 2);
  assert.equal(row(result, "legacy/server.py").status, "not-applicable");
  assert.equal(row(result, "legacy/server.py").classification, "documentary-or-historical-source");
});
test("a sibling TUFTE renderer cannot launder an unrelated page", () => {
  const result = report({ "package.json": manifest("a"), "good.mjs": `import { renderTufteDocument } from '${TUFTE}'; export const page = renderTufteDocument({});`, "bad.mjs": "export const page = '<main>Separate app</main>';" });
  assert.equal(row(result, "bad.mjs").frontendConformance.status, "nonconformant");
});
test("literal output with script-bound producer traces to actual renderer", () => {
  const result = report({ "sites/a/package.json": manifest("a", { scripts: { build: "node build.mjs" } }), "sites/a/build.mjs": `import { writeFileSync } from 'node:fs'; import { renderTufteDocument } from '${TUFTE}'; writeFileSync('dist/index.html', renderTufteDocument({}));`, "sites/a/dist/index.html": "<main>Generated</main>" });
  assert.equal(row(result, "sites/a/dist/index.html").frontendConformance.status, "conformant");
  assert.deepEqual(row(result, "sites/a/dist/index.html").producers, ["sites/a/build.mjs"]);
});
test("generated artifact without producer never passes", () => {
  const result = report({ "dist/index.html": "<main>Unknown producer</main>" });
  assert.equal(row(result, "dist/index.html").status, "unknown");
  assert.equal(result.complete, false);
});
test("dynamic import, unresolved import and syntax error remain explicit unknown", () => {
  for (const text of ["import(moduleName);", "import('./missing.mjs');", "export const x = ;"]) {
    const result = report({ "worker.mjs": text });
    assert.equal(row(result, "worker.mjs").status, "unknown");
    assert.equal(result.complete, false);
  }
});
test("unreadable and truncated filesystem observations cannot appear clean", () => {
  const walk = () => ({ files: [{ path: "server.mjs", kind: "file" }], skipped: 1, truncated: true });
  const result = projectWebConformance(readWebSourceSnapshot("/fixture", { walk, read: () => { throw Object.assign(new Error(), { code: "EACCES" }); } }));
  assert.equal(result.issues.length, 2);
  assert.equal(result.complete, false);
});
test("configuration retains active legacy target reference without claiming live", () => {
  const result = report({ "wrangler.jsonc": '{"main":"legacy/worker.mjs"}', "legacy/worker.mjs": "export default { fetch() { return new Response('ok'); } };" });
  assert.equal(row(result, "legacy/worker.mjs").activation.status, "declared");
  assert.equal(row(result, "legacy/worker.mjs").activation.live, "unobserved");
});
test("test fixtures are labeled while ordinary dev UI is required", () => {
  const result = report({ "test/fixture.html": "<main>Fixture</main>", "dev/index.html": "<main>Debug UI</main>" });
  assert.equal(row(result, "test/fixture.html").status, "not-applicable");
  assert.equal(row(result, "dev/index.html").status, "nonconformant");
});
test("nested administration and filesystem conformance use real walker", () => {
  const root = mkdtempSync(path.join(tmpdir(), "web-conformance-test-"));
  try {
    mkdirSync(path.join(root, "lib/service/sites/a"), { recursive: true });
    writeFileSync(path.join(root, "lib/service/sites/a/package.json"), manifest("a"));
    writeFileSync(path.join(root, "lib/service/sites/a/site-admin.config.json"), JSON.stringify({ endpoints: { "a.example": {} } }));
    writeFileSync(path.join(root, "lib/service/sites/a/index.html"), "<main>A</main>");
    writeFileSync(path.join(root, ".env"), "never read");
    assert.equal(readSiteAdministration(root).packages[0].package, "a");
    assert.equal(readWebConformance(root).summary.frontendRecords, 1);
    assert.equal(readWebSourceSnapshot(root).files.some((f) => f.path === ".env"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("input order does not change report", () => {
  const inputs = { "a.html": "<main>A</main>", "b.py": "HTTPServer(('', 8), Handler)" };
  assert.deepEqual(report(inputs), report(Object.fromEntries(Object.entries(inputs).reverse())));
});

test("trusted rich tile content remains valid while full-document escape is unresolved", () => {
  const valid = report({ "page.mjs": `import { renderTufteDocument } from '${TUFTE}'; export const page = renderTufteDocument({tiles:[{html:'<div>Article body</div>'}]});` });
  assert.equal(row(valid, "page.mjs").frontendConformance.status, "conformant");
  const escaped = report({ "page.mjs": `import { renderTufteDocument } from '${TUFTE}'; export const page = renderTufteDocument({tiles:[{html:'<!doctype html><html><body>Old app</body></html>'}]});` });
  assert.equal(row(escaped, "page.mjs").frontendConformance.status, "unknown");
});
test("client framework and dynamic escape cannot launder a frontend", () => {
  for (const escape of ["clientScript:'ReactDOM.createRoot(element)'", "headHtml: customHead"]) {
    const result = report({ "page.mjs": `import { renderTufteDocument } from '${TUFTE}'; export const page = renderTufteDocument({${escape}});` });
    assert.equal(row(result, "page.mjs").frontendConformance.status, "unknown");
  }
});
test("default Node namespace import construction is detected", () => {
  const result = report({ "server.mjs": "import http from 'node:http'; http.createServer(() => {});" });
  assert.equal(row(result, "server.mjs").serverConformance.status, "nonconformant");
});
test("Hugo output retains its actual declared generator", () => {
  const result = report({ "site/package.json": manifest("site", { scripts:{build:"hugo"} }), "site/public/index.html": "<main>Generated</main>" });
  assert.deepEqual(row(result, "site/public/index.html").producers, ["site/package.json"]);
  assert.equal(row(result, "site/public/index.html").classification, "generated-artifact");
  assert.equal(row(result, "site/public/index.html").status, "nonconformant");
});
test("simple deployment configuration is discharged by its proven source handler", () => {
  const result = report({ "wrangler.jsonc": '{"main":"worker.mjs"}', "worker.mjs": `import {createWebServer} from '${SERVER}'; const handler = createWebServer({}); export default {fetch:handler.fetch};` });
  assert.equal(row(result, "wrangler.jsonc").status, "not-applicable");
  assert.equal(result.complete, true);
});

test("CLI emits complete evidence and nonzero status for actual migration", () => {
  const root = mkdtempSync(path.join(tmpdir(), "web-conformance-cli-"));
  try {
    writeFileSync(path.join(root, "server.mjs"), "Deno.serve(() => new Response('ok'));");
    const cli = fileURLToPath(new URL("../scripts/check-web-conformance.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [cli, "--root", root], { encoding: "utf8" });
    assert.equal(result.status, 1);
    const body = JSON.parse(result.stdout);
    assert.equal(body.complete, false);
    assert.equal(body.records[0].serverConformance.status, "nonconformant");
    assert.equal(body.migrations[0].receiver, SERVER);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("declared legacy entry overrides historical custody", () => {
  const result = report({ "package.json": manifest("a", { scripts: { start: "node legacy/server.mjs" } }), "legacy/server.mjs": "import http from 'node:http'; http.createServer(() => {});" });
  assert.equal(row(result, "legacy/server.mjs").classification, "authored-server");
  assert.equal(row(result, "legacy/server.mjs").status, "nonconformant");
});

test("shadowed renderer binding is unknown rather than a false adoption proof", () => {
  const result = report({ "page.mjs": `import {renderTufteDocument} from '${TUFTE}'; export function render(renderTufteDocument) { return renderTufteDocument({}); }` });
  assert.equal(row(result, "page.mjs").status, "unknown");
  assert.ok(row(result, "page.mjs").unknowns.includes("imported-binding-shadowed"));
});
test("an explicitly served test page is an application obligation", () => {
  const result = report({ "wrangler.jsonc": '{"assets":{"directory":"test"}}', "test/index.html": "<main>A visible diagnostic</main>" });
  assert.notEqual(row(result, "test/index.html").classification, "test-fixture");
  assert.equal(row(result, "test/index.html").status, "nonconformant");
});
test("observed non-executable asset imports do not become missing source edges", () => {
  const result = projectWebConformance({ root: "/fixture", issues: [], assets:["style.css"], files:[{path:"server.mjs",text:`import './style.css'; import {createWebServer} from '${SERVER}'; createWebServer({});`}] });
  assert.equal(row(result, "server.mjs").status, "conformant");
});

test("nonweb config, own workflow and unrelated parse diagnostics are not migration obligations", () => {
  const result = report({
    ".codex/config.toml": 'model = "example"\ncommand = "node tool.mjs"',
    ".github/workflows/web-conformance.yml": 'name: Web conformance\njobs: {}\n# check wrangler deployment source',
    ".claude/workflows/understand-verify.js": 'const broken = ;',
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.migrations, []);
  assert.equal(row(result, ".claude/workflows/understand-verify.js").status, "not-applicable");
  assert.ok(row(result, ".claude/workflows/understand-verify.js").unknowns.includes("source-parse-error"));
});
test("archived manifests and internal import cycles cannot activate themselves", () => {
  const result = report({
    "legacy/site/package.json": manifest("old", { scripts:{start:"node app.mjs",build:"node build.mjs"} }),
    "legacy/site/app.mjs": "import './page.mjs'; export default {fetch() {return new Response('ok')}};",
    "legacy/site/page.mjs": "import './app.mjs'; export const html = '<main>Archived</main>';",
    "legacy/site/build.mjs": "import {writeFileSync} from 'node:fs'; writeFileSync('index.html','<main>Old output</main>');",
    "legacy/site/index.html": "<main>Old output</main>",
    "legacy/site/wrangler.jsonc": '{"main":"app.mjs"}',
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.migrations, []);
  for (const record of result.records) assert.equal(record.classification, "documentary-or-historical-source");
});
test("a current deployment activates the archived graph with its full root chain", () => {
  const result = report({
    "wrangler.jsonc": '{"main":"legacy/site/app.mjs"}',
    "legacy/site/package.json": manifest("old", {scripts:{start:"node app.mjs"}}),
    "legacy/site/app.mjs": "import './page.mjs'; export default {fetch() {return new Response('ok')}};",
    "legacy/site/page.mjs": "export const html = '<main>Currently reached</main>';",
  });
  assert.equal(row(result, "legacy/site/page.mjs").status, "nonconformant");
  assert.deepEqual(row(result, "legacy/site/page.mjs").activation.chain.map((step) => step.path), ["wrangler.jsonc", "legacy/site/app.mjs", "legacy/site/page.mjs"]);
});
test("a genuinely unresolved deployment entry remains an unknown application edge", () => {
  const result = report({ "wrangler.jsonc": '{"main":"missing-worker.mjs"}' });
  assert.equal(result.complete, false);
  assert.equal(row(result, "wrangler.jsonc").serverConformance.status, "unknown");
});
test("manifest-only server commands are explicit unresolved adapter edges", () => {
  const result = report({ "package.json": manifest("a", {scripts:{serve:"python3 -m http.server 8000"}}) });
  assert.equal(result.complete, false);
  assert.equal(row(result, "package.json").serverConformance.status, "unknown");
});

test("TUFTE applications supply both renderer and common-server composition evidence", () => {
  const result = report({ "worker.mjs": `import {createTufteApplication} from '${TUFTE}/application'; const app=createTufteApplication({pages:[]}); export default {fetch(request){return app(request)}};` });
  assert.equal(row(result, "worker.mjs").frontendConformance.status, "conformant");
  assert.equal(row(result, "worker.mjs").serverConformance.status, "conformant");
  assert.equal(row(result, "worker.mjs").serverConformance.evidence[0].via, "tufte-application");
});

test("SVG serialization supplies graphics, while its HTML consumer remains an obligation", () => {
  const result = report({ "graphic.mjs": "export function renderGraph(){return '<svg xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"1\"/></svg>'}", "page.mjs": "import {renderGraph} from './graphic.mjs'; export function page(){return '<main>'+renderGraph()+'</main>'}" });
  assert.equal(row(result,"graphic.mjs").frontend,false);
  assert.equal(row(result,"graphic.mjs").classification,"reusable-codec-or-transport");
  assert.equal(row(result,"page.mjs").status,"nonconformant");
});
test("test compiler output requires generator and receiving test command evidence", () => {
  const inputs={"package.json":manifest("a",{scripts:{pretest:"tsc -p tsconfig.test.json",test:'node --test ".tmp/test-dist/**/*.test.mjs"'}}),"tsconfig.test.json":JSON.stringify({compilerOptions:{rootDir:"src",outDir:".tmp/test-dist"}}),"src/view.mts":"export const view='<main>Source page</main>';",".tmp/test-dist/view.mjs":"export const view='<main>Compiled test page</main>';"};
  const result=report(inputs);
  assert.equal(row(result,".tmp/test-dist/view.mjs").classification,"generated-test-artifact");
  assert.equal(row(result,".tmp/test-dist/view.mjs").status,"not-applicable");
  assert.equal(row(result,"src/view.mts").status,"nonconformant");
  inputs['package.json']=manifest("a",{scripts:{pretest:"tsc -p tsconfig.test.json",test:'node --test ".tmp/test-dist/**/*.test.mjs"',start:"node .tmp/test-dist/view.mjs"}});
  assert.equal(row(report(inputs),".tmp/test-dist/view.mjs").status,"nonconformant");
});
test("Lake dependency installation is derived from its pinned manifest, not its directory name", () => {
  const inputs={"docs/lake-manifest.json":JSON.stringify({packagesDir:".lake/packages",packages:[{name:"verso",type:"git",url:"https://example.test/verso.git",rev:"abcdef"}]}),"docs/.lake/packages/verso/frontend/page.html":"<main>Third party template</main>","docs/output/index.html":"<main>Owned published output</main>"};
  const result=report(inputs);
  const dependency=row(result,"docs/.lake/packages/verso/frontend/page.html");
  assert.equal(dependency.classification,"installed-dependency");
  assert.equal(dependency.status,"not-applicable");
  assert.equal(dependency.roleEvidence.revision,"abcdef");
  assert.equal(row(result,"docs/output/index.html").status,"nonconformant");
  delete inputs['docs/lake-manifest.json'];
  assert.equal(row(report(inputs),"docs/.lake/packages/verso/frontend/page.html").status,"nonconformant");
});
test("the shared engine's exported upstream HTML primitive never requires a reverse dependency", () => {
  const inputs={"tufte/package.json":manifest(TUFTE,{dependencies:{"html-codec":"1.0.0"}}),"codec/package.json":manifest("html-codec",{exports:{'.':'./dist/project.mjs'},scripts:{build:"tsc -p tsconfig.build.json"}}),"codec/tsconfig.build.json":JSON.stringify({compilerOptions:{rootDir:"src",outDir:"dist"}}),"codec/src/project.mts":"export function project(){return '<!doctype html><html></html>'}","codec/dist/project.mjs":"export function project(){return '<!doctype html><html></html>'}","codec/docs/index.html":"<main>Actual documentation page</main>"};
  const result=report(inputs);
  for(const name of ['codec/src/project.mts','codec/dist/project.mjs']){
    assert.equal(row(result,name).classification,'upstream-web-primitive');
    assert.equal(row(result,name).status,'not-applicable');
    assert.deepEqual(row(result,name).roleEvidence.dependencyChain,[TUFTE,'html-codec']);
  }
  assert.equal(row(result,'codec/docs/index.html').status,'nonconformant');
});

test("engine implementation custody follows exports while its own example website remains obligated", () => {
  const result = report({
    "engine/package.json": manifest(SERVER, {exports:{".":"./src/index.mjs"}}),
    "engine/src/index.mjs": "export {serve} from './transport.mjs';",
    "engine/src/transport.mjs": "import {createServer} from 'node:http'; export const serve=()=>createServer(()=>{});",
    "engine/examples/index.html": "<main>Visible engine demo</main>",
  });
  assert.equal(row(result,"engine/src/transport.mjs").classification,"shared-engine");
  assert.equal(row(result,"engine/src/transport.mjs").status,"not-applicable");
  assert.equal(row(result,"engine/examples/index.html").status,"nonconformant");
});

test("only actual canonical engine exports prove family adoption", () => {
  const entries={};
  for(const [specifier,symbol] of [[SERVER,"createWebServer"],[PLATFORM+"/application","createWebApplication"],[PLATFORM,"createWebPlatform"],[SERVER+"/node","startWebServer"],[SERVER+"/node","createNodeServer"]]) entries[symbol+".mjs"]=`import {${symbol} as make} from '${specifier}'; export const engine=make({});`;
  for(const record of report(entries).records) assert.equal(record.serverConformance.status,"conformant");
  const old=report({"server.mjs":"import {createFetchHandler} from '@red-cup-engineering/http-server-core-service/fetch'; export const handler=createFetchHandler({});"});
  assert.equal(row(old,"server.mjs").serverConformance.status,"unknown");
  assert.ok(row(old,"server.mjs").unknowns.includes("superseded-server-family"));
  assert.equal(old.migrations[0].receiver,SERVER);
  const invented=report({"server.mjs":`import {createWebServer} from '${SERVER}/invented'; createWebServer({});`});
  assert.equal(row(invented,"server.mjs").status,"unknown");
});

test("obsolete facade helpers are not competing servers; their actual application consumers still are", () => {
  const result=report({
    "support.mjs":"import {witness,jsonRepr} from '@red-cup-engineering/http-server'; export const record=witness({}); export const value=jsonRepr({ok:true});",
    "server.mjs":"import './support.mjs'; export default {fetch(){return new Response('ok')}};",
  });
  assert.equal(row(result,"support.mjs").server,false);
  assert.equal(row(result,"support.mjs").classification,"reusable-codec-or-transport");
  assert.equal(row(result,"support.mjs").status,"not-applicable");
  assert.equal(row(result,"server.mjs").serverConformance.status,"nonconformant");
});
