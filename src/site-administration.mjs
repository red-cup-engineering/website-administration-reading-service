import { existsSync, readFileSync } from "node:fs";
import { walkPosixPathsSync } from "@red-cup-engineering/computer-filepath-engineering-services-section/walk-posix-paths";
import { WEB_SOURCE_SCOPE } from "./web-conformance.mjs";
import path from "node:path";

export function readSiteAdministration(repoRoot, params = {}) {
  const focus = cleanFocus(params.focus);
  const packages = sitePackages(repoRoot)
    .filter((pkg) => focus === null || matchesSiteFocus(pkg, focus))
    .sort((left, right) => left.package.localeCompare(right.package));
  return Object.freeze({ kind: "website-administration.reading", focus, packages: Object.freeze(packages) });
}

export function projectSiteAdministration(siteCandidates, params = {}) {
  if (!Array.isArray(siteCandidates)) throw new TypeError("siteCandidates must be an array");
  const focus = cleanFocus(params.focus);
  const packages = siteCandidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const endpoints = siteEndpoints(candidate.configuration?.endpoints);
    if (endpoints.length === 0) return [];
    return [Object.freeze({
      kind: "website-administration.site-package",
      package: stringOr(candidate.manifest?.name, candidate.name),
      description: stringOr(candidate.manifest?.description, ""),
      path: candidate.path,
      scripts: stringKeys(candidate.manifest?.scripts),
      exports: exportNames(candidate.manifest?.exports),
      endpoints,
    })];
  }).filter((pkg) => focus === null || matchesSiteFocus(pkg, focus))
    .sort((left, right) => left.package.localeCompare(right.package));
  return Object.freeze({ kind: "website-administration.reading", focus, packages: Object.freeze(packages) });
}

function sitePackages(repoRoot) {
  const observed = walkPosixPathsSync({ root: repoRoot, excludes: WEB_SOURCE_SCOPE.excludes,
    includeFile: (entry) => entry.name === "site-admin.config.json", symlinks: "skip" });
  const candidates = observed.files.flatMap((entry) => {
    const configPath = path.join(repoRoot, entry.path);
    const packagePath = path.join(path.dirname(configPath), "package.json");
    if (!existsSync(packagePath)) return [];
    return [{ name: path.basename(path.dirname(configPath)), path: path.relative(repoRoot, path.dirname(configPath)),
      manifest: JSON.parse(readFileSync(packagePath, "utf8")), configuration: JSON.parse(readFileSync(configPath, "utf8")) }];
  });
  return projectSiteAdministration(candidates).packages;
}

function siteEndpoints(input) {
  if (Array.isArray(input)) return Object.freeze(input.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const name = typeof entry.domain === "string" ? entry.domain : null;
    return name === null ? [] : [siteEndpoint(name, entry)];
  }));
  if (!input || typeof input !== "object") return Object.freeze([]);
  return Object.freeze(Object.entries(input).map(([name, raw]) => siteEndpoint(
    name,
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {},
  )));
}

function siteEndpoint(name, record) {
  const port = integerOrNull(record.port);
  const configuredOperations = operationProbes(record.operations);
  return Object.freeze({
    name,
    publicUrl: `https://${name}/`,
    localUrl: port === null ? null : `http://127.0.0.1:${port}`,
    port,
    access: typeof record.access === "string" ? record.access : null,
    operations: configuredOperations.length > 0
      ? configuredOperations
      : name.startsWith("newsroom.") ? Object.freeze([operationProbe("/publication-game.json")]) : Object.freeze([]),
  });
}

function operationProbes(input) {
  if (!Array.isArray(input)) return Object.freeze([]);
  return Object.freeze(input.flatMap((item) => {
    if (typeof item === "string" && item.trim() !== "") return [operationProbe(item.trim())];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const pathname = typeof item.path === "string" && item.path.trim() !== "" ? item.path.trim() : null;
    if (pathname === null) return [];
    return [operationProbe(pathname, item.method ?? "GET", item.body, integerOrNull(item.timeoutMs) ?? undefined, item.responseType)];
  }));
}

function operationProbe(pathname, method = "GET", body = null, timeoutMs = 5000, responseType) {
  if (!["GET", "HEAD", "POST"].includes(method)) throw new TypeError("operation method must be GET, HEAD, or POST");
  if (responseType !== undefined && !["json", "text", "none"].includes(responseType)) throw new TypeError("invalid operation responseType");
  return Object.freeze({ path: pathname.startsWith("/") ? pathname : `/${pathname}`, method, body, timeoutMs,
    ...(responseType === undefined ? {} : { responseType }) });
}

function matchesSiteFocus(pkg, focus) {
  const candidates = siteFocusCandidates(focus);
  return candidates.has(pkg.package) || candidates.has(pkg.path) || candidates.has(path.basename(pkg.path))
    || pkg.endpoints.some((endpoint) => candidates.has(endpoint.name));
}

function siteFocusCandidates(focus) {
  const trimmed = focus.trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\//u, "");
  const withoutQuery = withoutProtocol.split(/[?#]/u, 1)[0] ?? withoutProtocol;
  const withoutTrailingSlash = withoutQuery.replace(/\/+$/u, "");
  const withoutDotSlash = withoutTrailingSlash.replace(/^\.\//u, "");
  return new Set([trimmed, withoutProtocol, withoutQuery, withoutTrailingSlash, withoutDotSlash, path.normalize(withoutDotSlash)].filter(Boolean));
}

function stringKeys(input) { return !input || typeof input !== "object" || Array.isArray(input) ? Object.freeze([]) : Object.freeze(Object.keys(input).sort()); }
function exportNames(input) { return typeof input === "string" ? Object.freeze(["."]) : stringKeys(input); }
function stringOr(input, fallback) { return typeof input === "string" ? input : fallback; }
function integerOrNull(input) { return Number.isInteger(input) ? input : null; }
function cleanFocus(input) { const focus = typeof input === "string" ? input.trim() : ""; return focus === "" ? null : focus; }
