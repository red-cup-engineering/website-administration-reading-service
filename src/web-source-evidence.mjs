import ts from "typescript";
import { readImports } from "@red-cup-engineering/javascript-computer";

export const TUFTE = "@red-cup-engineering/web-page-tiling-engine";
export const SERVER = "@red-cup-engineering/computer-web-server";
export const PLATFORM = "@red-cup-engineering/computer-web-platform";
export const LEGACY_SERVERS = ["@red-cup-engineering/http-server-core-service", "@red-cup-engineering/http-server", "@red-cup-engineering/http-server-platform-service", "@red-cup-engineering/web-server-services-section", "@emsenn/http-server", "@emsenn/web-server"];
const engineExports = new Map([
  [SERVER, ["createWebServer"]],
  [SERVER + "/native-application", ["startNativeApplication", "nativeHttpHandler"]],
  [SERVER + "/node", ["startWebServer", "createNodeServer", "bindWebServer"]],
  [PLATFORM, ["createWebPlatform"]],
  [PLATFORM + "/application", ["createWebApplication"]],
]);
const html = /<(?:!doctype\s+html|html|body|main|form|button|input|canvas|div|section|article|nav)\b/i;
const renderer = /^(?:renderTufte(?:Document|Fragment|Packet)|createTufteApplication|connectTufteDocument)$/;
const member = (node) => ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? `${member(node.expression)}.${node.name.text}` : null;
const literal = (node) => node && ts.isStringLiteralLike(node) ? node.text : null;
const own = (value, name) => value === name || value?.startsWith(`${name}/`);

/** @param {{path:string,text:string}} input
 * @returns {{imports:object[],calls:object[],signals:object[],unknowns:string[],outputs:string[]}}
 * Syntax evidence only: calls do not establish execution, installation, or deployment.
 */
export function inspectWebSource({ path, text }) {
  if (typeof path !== "string" || typeof text !== "string") throw new TypeError("path and text required");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.jsx$/.test(path) ? ts.ScriptKind.JSX : /\.[mc]?ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const imports = readImports(text, path).filter((entry) => !entry.typeOnly);
  const bindings = new Map(), calls = [], signals = [], outputs = [], unknowns = [];
  const emit = (kind, node, details = {}) => signals.push({ kind, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, ...details });
  if (source.parseDiagnostics.length) unknowns.push("source-parse-error");
  for (const entry of imports) if (entry.mode === "dynamic") unknowns.push(entry.specifier ? "dynamic-import-binding" : "nonliteral-dynamic-import");
  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && !node.importClause) { imports.push({ specifier: literal(node.moduleSpecifier), mode: "side-effect", typeOnly: false }); return; }
    if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly) return;
    const specifier = literal(node.moduleSpecifier), clause = node.importClause;
    if (clause.name) bindings.set(clause.name.text, { specifier, symbol: "default" });
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bindings.set(clause.namedBindings.name.text, { specifier, symbol: "*" });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const el of clause.namedBindings.elements) if (!el.isTypeOnly) bindings.set(el.name.text, { specifier, symbol: (el.propertyName ?? el.name).text });
  });
  for (const entry of imports) if (/^(?:node:)?(?:https?|http2)$|^(?:ws|undici|@hono\/)/.test(entry.specifier ?? "")) signals.push({ kind: "transport-import", line: 1, specifier: entry.specifier });
  const visit = (node) => {
    if (ts.isFunctionLike(node)) for (const parameter of node.parameters) if (ts.isIdentifier(parameter.name) && bindings.has(parameter.name.text)) unknowns.push("imported-binding-shadowed");
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && bindings.has(node.name.text) && !(node.initializer && ts.isCallExpression(node.initializer) && member(node.initializer.expression) === "require")) unknowns.push("imported-binding-shadowed");
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && member(node.initializer.expression) === "require") {
      const specifier = literal(node.initializer.arguments[0]);
      if (!specifier) unknowns.push("nonliteral-require");
      else {
        imports.push({ specifier, mode: "namespace", typeOnly: false });
        if (ts.isIdentifier(node.name)) bindings.set(node.name.text, { specifier, symbol: "*" });
        else if (ts.isObjectBindingPattern(node.name)) for (const el of node.name.elements) bindings.set(el.name.getText(source), { specifier, symbol: (el.propertyName ?? el.name).getText(source) });
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = member(node.expression), segments = name?.split(".") ?? [], binding = bindings.get(segments[0]);
      const symbol = binding?.symbol === "*" || (binding?.symbol === "default" && segments.length > 1) ? segments.slice(1).join(".") : binding?.symbol;
      if (binding) {
        const call = { specifier: binding.specifier, symbol, local: name, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
        calls.push(call);
        if (own(binding.specifier, TUFTE)) {
          if (renderer.test(symbol ?? "")) emit("tufte-render-call", node, call);
          if (symbol === "createTufteApplication") emit("shared-server-call", node, { ...call, via: "tufte-application" });
          else if (/^(?:normalizeTufte|connectTufte|renderTufteStyles)/.test(symbol ?? "")) emit("shared-support-call", node, call);
        }
        if (own(binding.specifier, SERVER) || own(binding.specifier, PLATFORM)) {
          if (engineExports.get(binding.specifier)?.includes(symbol)) emit("shared-server-call", node, call);
          else { emit("shared-support-call", node, call); unknowns.push("unproven-server-family-export"); }
        }
        if (LEGACY_SERVERS.some((name) => own(binding.specifier, name))) {
          if (/^(?:createFetchHandler|createServer|start|handler|fromFetch|createMcpApp|serveScripts|mountApp)$/.test(symbol ?? "")) {
            emit("legacy-server-family-call", node, call);
            unknowns.push("superseded-server-family");
          } else emit("legacy-support-call", node, call);
        }
        if (/^(?:node:)?https?$|^(?:node:)?http2$/.test(binding.specifier ?? "") && /^(?:createServer|createSecureServer)$/.test(symbol ?? "")) emit("native-node-server", node, call);
        if (/^(?:express|fastify|koa|hono)(?:\/|$)/.test(binding.specifier ?? "")) emit("alternative-server-framework", node, call);
        if (/^(?:react-dom|preact|vue|svelte)(?:\/|$)/.test(binding.specifier ?? "")) emit("alternative-frontend-framework", node, call);
      }
      if (/^(?:Deno|Bun)\.serve$/.test(name ?? "")) emit("native-fetch-server", node);
      if (/^(?:eval|Function)$/.test(name ?? "")) unknowns.push("dynamic-code");
      if (/^(?:writeFile|writeFileSync)$/.test(symbol ?? segments.at(-1) ?? "")) {
        const target = literal(node.arguments?.[0]);
        if (target) outputs.push(target);
        else if ((node.arguments?.[0]?.getText(source) ?? "").includes(".html")) unknowns.push("dynamic-generated-output-path");
      }
    }
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /<svg\b/i.test(node.text)) emit("vector-graphic-serialization", node);
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && html.test(node.text)) {
      const fullDocument = /<(?:!doctype\s+html|html|body)\b/i.test(node.text);
      const richTile = ts.isPropertyAssignment(node.parent) && node.parent.name.getText(source) === "html" && !fullDocument && !/<script\b/i.test(node.text);
      emit("html-construction", node, { fullDocument, richTile });
    }
    if (ts.isPropertyAssignment(node) && ["headHtml", "clientScript"].includes(node.name.getText(source))) {
      const value = literal(node.initializer);
      if (value === null) unknowns.push("dynamic-frontend-escape");
      else if (/<(?:!doctype|html|body)|ReactDOM|createRoot|Vue\.createApp|innerHTML\s*=/i.test(value)) emit("raw-frontend-escape", node);
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) emit("jsx-construction", node);
    if (ts.isMethodDeclaration(node) && node.name?.getText(source) === "fetch") emit("fetch-handler", node);
    if (ts.isPropertyAssignment(node) && node.name?.getText(source) === "fetch" && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) emit("fetch-handler", node);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "fetch" && node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)) emit("fetch-handler", node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, calls, signals, unknowns: [...new Set(unknowns)].sort(), outputs: [...new Set(outputs)].sort() };
}
