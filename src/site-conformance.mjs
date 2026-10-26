import { createHash } from "node:crypto";

const INTENTS = new Set(["index", "exclude", "redirect", "alternate", "gone", "unknown"]);
const DEFAULT_STATUSES = { index: [200], exclude: [200], alternate: [200], redirect: [301, 302, 303, 307, 308], gone: [404, 410] };
export const SITE_CONFORMANCE_LIMITS = Object.freeze({ routes: 128, observations: 1024, searchConsole: 256, bodyBytes: 2_097_152, totalBodyBytes: 33_554_432 });

/** Pure, bounded reconciliation of route policy, HTTP observations, and provider
 * notices. The declared cover is exact URL + method, never a whole-domain pass.
 * It neither fetches, hires, pays, mutates a site, nor requests Google validation.
 */
export function projectSiteConformance(input) {
  if (!input || !Array.isArray(input.routes) || !Array.isArray(input.observations)) throw new TypeError("routes and observations required");
  if (input.searchConsole !== undefined && !Array.isArray(input.searchConsole)) throw new TypeError("searchConsole must be an array");
  for (const key of ["routes", "observations", "searchConsole"]) if ((input[key]?.length ?? 0) > SITE_CONFORMANCE_LIMITS[key]) throw new RangeError(`${key} exceeds the bounded conformance limit`);
  const site = text(input.site, "site"), owner = text(input.owner, "owner");
  const siteUrl = new URL(httpUrl(/^https?:\/\//i.test(site) ? site : `https://${site}/`));
  if (siteUrl.pathname !== "/" || siteUrl.search) throw new TypeError("site must identify an HTTP origin");
  const origin = siteUrl.origin;
  const sourceContext = { ...input.sourceContext, policyRevision: text(input.sourceContext?.policyRevision, "policyRevision") };
  const evaluatedAt = text(input.evaluatedAt, "evaluatedAt"), now = timestamp(evaluatedAt);
  const maxAgeMs = input.maxAgeMs ?? 86_400_000;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) throw new TypeError("maxAgeMs must be a nonnegative safe integer");
  const routes = input.routes.map(routePolicy), routeKeys = new Set();
  for (const route of routes) { const key = routeKey(route); if (new URL(route.url).origin !== origin) throw new TypeError("route must belong to the site's exact HTTP origin"); if (routeKeys.has(key)) throw new TypeError("duplicate route policy"); routeKeys.add(key); }
  let totalBodyBytes = 0;
  const observations = input.observations.map((value) => {
    const bytes = typeof value.body === "string" ? Buffer.byteLength(value.body) : 0;
    if (bytes > SITE_CONFORMANCE_LIMITS.bodyBytes) throw new RangeError("observation body exceeds the bounded conformance limit");
    totalBodyBytes += bytes;
    if (totalBodyBytes > SITE_CONFORMANCE_LIMITS.totalBodyBytes) throw new RangeError("aggregate observation bodies exceed the bounded conformance limit");
    return { ...value, id: text(value.id, "observation id"), url: httpUrl(value.url), method: readMethod(value.method), time: timestamp(value.observedAt), completedTime: value.completedAt === undefined ? null : timestamp(value.completedAt) };
  });
  const findings = new Map(), records = [], providerNotices = [];
  const add = (route, code, status, action, expected, observed, evidence) => {
    const identity = JSON.stringify([site, route?.url ?? null, route?.method ?? null, code]);
    const id = `site-finding:${createHash("sha256").update(identity).digest("hex")}`;
    const existing = findings.get(id);
    if (existing) {
      existing.evidence.push(...evidence.filter((item) => !existing.evidence.some((previous) => previous.id === item.id)));
      return existing;
    }
    const finding = { id, code, status, action, site, url: route?.url ?? null, method: route?.method ?? null, owner, expected, observed, evidence: [...evidence], sourceContext: { ...sourceContext } };
    findings.set(id, finding); return finding;
  };
  for (const route of routes) {
    const candidates = observations.filter((entry) => routeKey(entry) === routeKey(route)).sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
    const observation = candidates[0] ?? null, checks = [];
    const check = (code, status, expected, observed, evidence = observation ? [reference(observation)] : []) => {
      checks.push({ code, status, expected, observed, evidence });
      if (status === "unknown" || status === "nonconformant") add(route, code, status, status === "nonconformant" ? "repair" : "investigate", expected, observed, evidence);
    };
    if (!observation) check("observation-missing", "unknown", "fresh observation of the exact URL and method", null);
    else if (observation.completedTime !== null && observation.completedTime < observation.time) check("observation-interval-invalid", "unknown", "completion at or after observation start", { observedAt: observation.observedAt, completedAt: observation.completedAt });
    else if (observation.time > now || observation.completedTime !== null && observation.completedTime > now) check("observation-in-future", "unknown", `observation no later than ${evaluatedAt}`, { observedAt: observation.observedAt, completedAt: observation.completedAt ?? null });
    else if (now - observation.time > maxAgeMs) check("observation-stale", "unknown", { maxAgeMs }, { observedAt: observation.observedAt, ageMs: now - observation.time });
    else if (candidates.some((entry) => entry.time === observation.time && observationSignature(entry) !== observationSignature(observation))) {
      check("observation-conflict", "unknown", "compatible observations at the same observation time", "contradictory HTTP evidence", candidates.filter((entry) => entry.time === observation.time).map(reference));
    } else if (sourceContext.deploymentRevision && observation.deploymentRevision !== sourceContext.deploymentRevision) {
      check("deployment-revision-unbound", "unknown", sourceContext.deploymentRevision, observation.deploymentRevision ?? null);
    } else if (observation.redirected === true || observation.finalUrl && httpUrl(observation.finalUrl) !== route.url) {
      check("redirect-source-unobserved", "unknown", "the source response before redirect following", { finalUrl: observation.finalUrl ?? null });
    } else {
      const status = observation.httpStatus;
      if (!Number.isInteger(status) || status < 100 || status > 599) check("http-response-unobserved", "unknown", "an HTTP response status", { reason: observation.reason ?? null });
      else if (route.intent === "unknown") check("route-intent-unbound", "unknown", "owner-declared route policy", status);
      else {
        const expected = route.expectedStatusCodes ?? DEFAULT_STATUSES[route.intent];
        check("http-status", expected.includes(status) ? "conformant" : "nonconformant", expected, status);
        if (route.intent === "index" && status === 200) {
          const noindex = responseNoindex(observation);
          check("indexing-directive", noindex === true ? "nonconformant" : noindex === false ? "conformant" : "unknown", "no server-delivered Google noindex directive", noindex);
        }
        if (route.intent === "exclude" && status === 200) {
          const noindex = responseNoindex(observation);
          check("exclusion-directive", noindex === true ? "conformant" : "unknown", "observed noindex or separate source-qualified exclusion evidence", noindex);
        }
        if (route.canonicalUrl && ["redirect", "alternate", "index"].includes(route.intent)) {
          const targets = responseCanonicals(observation, route.intent === "redirect");
          const incomplete = route.intent !== "redirect" && canonicalInspectionIncomplete(observation);
          check("canonical-target", targets.length === 0 ? "unknown" : targets.length > 1 || targets[0] !== route.canonicalUrl ? "nonconformant" : incomplete ? "unknown" : "conformant", route.canonicalUrl, targets);
        }
      }
    }
    records.push({ ...route, observation: observation ? reference(observation) : null, checks, status: aggregate(checks.map((item) => item.status)) });
  }
  for (const raw of input.searchConsole ?? []) {
    const alert = { ...raw, id: text(raw.id, "Search Console evidence id"), property: text(raw.property, "Search Console property"), reason: text(raw.reason, "Search Console reason"), time: timestamp(raw.observedAt), source: raw.source ?? "google-search-console" };
    const url = raw.url === undefined || raw.url === null ? null : httpUrl(raw.url);
    const route = url ? routes.find((item) => item.url === url && item.method === "GET") : null;
    const code = googleReason(alert.reason), evidence = [{ id: alert.id, source: alert.source, observedAt: alert.observedAt, property: alert.property, ...(url ? { url, method: "GET" } : {}) }];
    let classification = "expected";
    if (!(url ? propertyContains(alert.property, url) : propertyContains(alert.property, siteUrl.href) || routes.some((entry) => propertyContains(alert.property, entry.url)))) {
      classification = "unbound";
      add(null, `search-console-property-mismatch:${code}`, "unknown", "investigate", "provider property covering the reported URL and site scope", { property: alert.property, url, reason: alert.reason }, evidence);
    } else if (!route) {
      classification = "unbound";
      const withinOrigin = url && new URL(url).origin === origin;
      add(withinOrigin ? { url, method: "GET" } : null, `search-console-${url ? "route-uncovered" : "url-unbound"}:${code}`, "unknown", "investigate", "exact affected URL bound to owner policy", { property: alert.property, url, reason: alert.reason }, evidence);
    } else if (alert.time > now || now - alert.time > maxAgeMs) {
      classification = "stale";
      add(route, `search-console-stale:${code}`, "unknown", "investigate", { maxAgeMs }, { observedAt: alert.observedAt, reason: alert.reason }, evidence);
    } else if (!expectedGoogleReason(code, route)) {
      classification = "unresolved";
      // A provider notice records Google's state, not current origin causality.
      // A later successful fetch alone cannot close Google revalidation.
      add(route, `search-console-unresolved:${code}`, "unknown", "investigate", { intent: route.intent, canonicalUrl: route.canonicalUrl ?? null }, { property: alert.property, reason: alert.reason }, evidence);
    }
    providerNotices.push({ id: alert.id, property: alert.property, url, reason: alert.reason, classification, evidence, sourceContext: { ...sourceContext } });
  }
  if (!routes.length) add(null, "route-cover-empty", "unknown", "investigate", "an explicit nonempty route cover", [], []);
  const ordered = [...findings.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { kind: "website-administration.site-conformance", schemaVersion: 1, site, owner, sourceContext, evaluatedAt, maxAgeMs,
    scope: { origin, routes: routes.map(({ url, method }) => ({ url, method })),
      evidence: "Exact HTTP responses, server-delivered indexing directives, declared canonical targets, and source-qualified provider notices.",
      excludes: ["unlisted routes", "browser rendering and accessibility", "robots.txt interpretation without separate route evidence", "proof of Google indexing", "payment, hiring, deployment, or repair execution"] },
    records, findings: ordered, providerNotices, summary: { routes: records.length, observations: observations.length, findings: ordered.length, providerNotices: providerNotices.length,
      byStatus: count(records.map((record) => record.status)), byAction: count(ordered.map((finding) => finding.action)) },
    complete: routes.length > 0 && ordered.length === 0 && records.every((record) => record.status === "conformant") };
}

function routePolicy(raw) {
  if (!INTENTS.has(raw?.intent)) throw new TypeError("explicit route intent required");
  const route = { url: httpUrl(raw.url), method: readMethod(raw.method ?? "GET"), intent: raw.intent };
  if (raw.expectedStatusCodes !== undefined) {
    if (!Array.isArray(raw.expectedStatusCodes) || !raw.expectedStatusCodes.length || raw.expectedStatusCodes.some((code) => !Number.isInteger(code) || code < 100 || code > 599)) throw new TypeError("expectedStatusCodes must contain HTTP status codes");
    route.expectedStatusCodes = [...new Set(raw.expectedStatusCodes)].sort();
    if (["index", "alternate", "redirect", "gone"].includes(raw.intent) && route.expectedStatusCodes.some((code) => !DEFAULT_STATUSES[raw.intent].includes(code))) throw new TypeError("expectedStatusCodes contradict the declared route intent");
  }
  if (raw.canonicalUrl !== undefined) route.canonicalUrl = httpUrl(raw.canonicalUrl);
  return route;
}
function googleReason(reason) {
  const value = reason.toLowerCase();
  if (value.includes("robots.txt")) return "robots";
  if (value.includes("noindex")) return "noindex";
  if (value.includes("alternate page with proper canonical")) return "alternate";
  if (value.includes("page with redirect")) return "redirect";
  if (value.includes("not found") && value.includes("404")) return "not-found";
  if (value.includes("server error") || value.includes("5xx")) return "server-error";
  if (value.includes("duplicate without user-selected canonical")) return "canonical-unselected";
  return `other-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}
function expectedGoogleReason(code, route) {
  if (["robots", "noindex"].includes(code)) return route.intent === "exclude";
  if (code === "redirect") return route.intent === "redirect";
  if (code === "alternate") return route.intent === "alternate" && Boolean(route.canonicalUrl);
  if (code === "not-found") return route.intent === "gone";
  if (code === "server-error") return route.intent === "exclude" && route.expectedStatusCodes?.some((status) => status >= 500);
  return false;
}
function propertyContains(property, url) {
  try {
    const target = new URL(url);
    if (property.startsWith("sc-domain:")) {
      const domain = property.slice(10);
      if (!domain || /[\s/@:#?]/.test(domain)) return false;
      const host = new URL(`https://${domain}/`).hostname;
      return target.hostname === host || target.hostname.endsWith(`.${host}`);
    }
    const prefix = new URL(httpUrl(property));
    return prefix.origin === target.origin && target.href.startsWith(prefix.href);
  } catch { return false; }
}
function responseNoindex(observation) {
  const header = headerValue(observation, "x-robots-tag");
  let agent = null;
  for (let directive of (header ?? "").split(",")) {
    const scoped = directive.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
    if (scoped && !["max-snippet", "max-image-preview", "max-video-preview", "unavailable_after"].includes(scoped[1].toLowerCase())) { agent = scoped[1].toLowerCase(); directive = scoped[2]; }
    if ((agent === null || agent === "googlebot") && /(?:^|[;\s])(?:noindex|none)(?:$|[;\s])/i.test(directive)) return true;
  }
  if (observation.method === "HEAD" || observation.bodyTruncated || typeof observation.body !== "string" || !/text\/html|application\/xhtml\+xml/i.test(headerValue(observation, "content-type") ?? "")) return null;
  const body = withoutInertContent(observation.body), metadata = tags(body, "meta");
  for (const attrs of metadata) if (["robots", "googlebot"].includes(attrs.name?.toLowerCase()) && /(?:^|[,\s])(?:noindex|none)(?:$|[,\s])/i.test(attrs.content ?? "")) return true;
  if ((body.match(/<meta\b/gi) ?? []).length !== metadata.length || metadata.some((attrs) => /&[\w#]+;/.test(attrs.name ?? "") || ["robots", "googlebot"].includes(attrs.name?.toLowerCase()) && /&[\w#]+;/.test(attrs.content ?? ""))) return null;
  return false;
}
function responseCanonicals(observation, redirect) {
  const found = [], location = headerValue(observation, "location");
  if (redirect && location) found.push(location);
  if (!redirect) {
    for (const match of (headerValue(observation, "link") ?? "").matchAll(/<([^>]+)>\s*;\s*rel\s*=\s*["']?canonical\b/gi)) found.push(match[1]);
    if (!observation.bodyTruncated && typeof observation.body === "string" && /text\/html|application\/xhtml\+xml/i.test(headerValue(observation, "content-type") ?? "")) for (const attrs of tags(withoutInertContent(observation.body), "link")) if (attrs.rel?.toLowerCase().split(/\s+/).includes("canonical") && attrs.href) found.push(attrs.href);
  }
  return [...new Set(found.map((value) => { try { return httpUrl(new URL(value.replace(/&amp;/g, "&"), observation.url).href); } catch { return "invalid-canonical-url"; } }))];
}
function canonicalInspectionIncomplete(observation) {
  if (observation.method === "HEAD") return false;
  const type = headerValue(observation, "content-type");
  if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) return false;
  if (observation.bodyTruncated || typeof observation.body !== "string") return true;
  const body = withoutInertContent(observation.body);
  return (body.match(/<link\b/gi) ?? []).length !== tags(body, "link").length;
}
function tags(body, name) {
  return [...body.matchAll(new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, "gi"))].map(([tag]) => {
    const attrs = {};
    for (const match of tag.matchAll(/\s([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      const name = match[1].toLowerCase();
      if (!Object.hasOwn(attrs, name)) attrs[name] = decodeAttribute(match[2] ?? match[3] ?? match[4]);
    }
    return attrs;
  });
}
function withoutInertContent(body) { return body.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ""); }
function decodeAttribute(value) {
  const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", Tab: "\t", NewLine: "\n" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[A-Za-z]+);/gi, (original, entity) => {
    if (entity.startsWith("#")) {
      const point = /^#x/i.test(entity) ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : original;
    }
    return entities[entity] ?? original;
  });
}
function observationSignature(value) { return JSON.stringify([value.httpStatus ?? null, value.status, value.finalUrl ?? null, value.redirected ?? false, value.deploymentRevision ?? null, value.bodyTruncated ?? false, value.headers ?? {}, value.body ?? null]); }
function reference(value) { return { id: value.id, source: value.source ?? "http-probe", url: value.url, method: value.method, observedAt: value.observedAt, ...(value.completedAt === undefined ? {} : { completedAt: value.completedAt }), httpStatus: value.httpStatus ?? null, deploymentRevision: value.deploymentRevision ?? null }; }
function headerValue(value, name) { const key = Object.keys(value.headers ?? {}).find((key) => key.toLowerCase() === name); return key === undefined ? null : String(value.headers[key]); }
function aggregate(statuses) { return statuses.includes("nonconformant") ? "nonconformant" : statuses.includes("unknown") ? "unknown" : "conformant"; }
function count(values) { return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length])); }
function routeKey(route) { return JSON.stringify([route.url, route.method]); }
function readMethod(value) { if (!["GET", "HEAD"].includes(value)) throw new TypeError("conformance method must be GET or HEAD"); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} required`); return value; }
function timestamp(value) { const time = Date.parse(text(value, "timestamp")); if (!Number.isFinite(time) || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new TypeError("timestamp with explicit timezone required"); return time; }
function httpUrl(value) { const url = new URL(text(value, "url")); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new TypeError("HTTP(S) URL without credentials or fragment required"); return url.href; }
