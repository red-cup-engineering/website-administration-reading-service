import { createHash, randomUUID } from "node:crypto";

const METHODS = new Set(["GET", "HEAD", "POST"]);
const RESPONSE_TYPES = new Set(["json", "text", "none"]);
const EVIDENCE_HEADERS = ["content-type", "content-encoding", "location", "link", "x-robots-tag", "etag", "last-modified", "cache-control", "retry-after", "x-deployment-revision"];

export function projectSiteOperationRequests(administration, { target } = {}) {
  if (!administration || !Array.isArray(administration.packages)) throw new TypeError("administration must carry packages");
  if (target !== undefined && !["public", "local"].includes(target)) throw new TypeError("target must be public or local");
  return Object.freeze(administration.packages.flatMap((pkg) => pkg.endpoints.flatMap((endpoint) => endpoint.operations.map((operation) => {
    const base = target === "public" ? endpoint.publicUrl : target === "local" ? endpoint.localUrl : endpoint.localUrl ?? endpoint.publicUrl;
    if (typeof operation.path !== "string" || !/^\/(?!\/)/u.test(operation.path)) throw new TypeError("operation path must be an origin-relative path");
    const url = new URL(operation.path, requiredUrl(base)).href;
    return Object.freeze({ kind: "website-administration.operation-request", endpoint: endpoint.name, url,
      method: requiredMethod(operation.method ?? "GET"), body: operation.body, timeoutMs: operation.timeoutMs,
      ...(operation.responseType === undefined ? {} : { responseType: requiredResponseType(operation.responseType) }),
    });
  }))));
}

/** One explicitly requested operation. Observation records are evidence, not a
 * claim of independent inspection, indexing, deployment, or successful repair.
 * Redirects are retained by default so a redirected source cannot masquerade as
 * its target. No cookies, authorization, or response Set-Cookie are retained.
 */
export async function observeSiteOperation(request, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch, clock = options.clock ?? (() => new Date().toISOString());
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  const endpoint = requiredText(request.endpoint, "endpoint"), url = requiredUrl(request.url);
  const method = requiredMethod(request.method ?? "GET"), responseType = requiredResponseType(request.responseType ?? "json");
  const redirect = request.redirect ?? "manual";
  if (!["manual", "follow", "error"].includes(redirect)) throw new TypeError("invalid redirect policy");
  const observedAt = clock(), controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timeout = setTimeout(() => controller.abort(), boundedTimeout(request.timeoutMs));
  const evidence = { kind: "website-administration.operation-observation", schemaVersion: 1, endpoint, url, method,
    observedAt, source: "http-probe", responseType, redirect, httpStatus: null, finalUrl: null, redirected: false,
    headers: {}, deploymentRevision: null, bodyTruncated: false };
  let response;
  try {
    response = await fetchImpl(url, {
      method, redirect, signal,
      headers: { Accept: responseType === "json" ? "application/json" : "text/html, text/plain;q=0.9, */*;q=0.8",
        ...(options.identityContentCoding ? { "Accept-Encoding": "identity" } : {}),
        ...(options.userAgent ? { "User-Agent": options.userAgent } : {}),
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(method === "POST" ? { body: JSON.stringify(request.body ?? {}) } : {}),
    });
    evidence.httpStatus = Number.isInteger(response.status) ? response.status : null;
    evidence.finalUrl = response.url || url;
    evidence.redirected = response.redirected === true;
    evidence.headers = Object.fromEntries(EVIDENCE_HEADERS.flatMap((name) => {
      const value = response.headers?.get?.(name); return value === null || value === undefined ? [] : [[name, value]];
    }));
    if (response.headersDistinct && typeof response.headersDistinct === "object") {
      evidence.headerValues = Object.fromEntries(EVIDENCE_HEADERS.flatMap((name) => {
        const values = response.headersDistinct[name];
        return Array.isArray(values) && values.every(value => typeof value === "string") ? [[name, [...values]]] : [];
      }));
    }
    evidence.deploymentRevision = evidence.headers["x-deployment-revision"] ?? null;
    let body = null;
    if (options.identityContentCoding && evidence.headers["content-encoding"] && evidence.headers["content-encoding"].toLowerCase() !== "identity")
      throw Object.assign(new Error("unsupported-response-content-coding"), { code: "REPRESENTATION_UNREAD" });
    const charset = evidence.headers["content-type"]?.match(/;\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))/i);
    if (options.identityContentCoding && charset && !/^(?:utf-8|utf8|us-ascii|ascii)$/i.test(charset[1] ?? charset[2] ?? charset[3]))
      throw Object.assign(new Error("unsupported-response-charset"), { code: "REPRESENTATION_UNREAD" });
    if (method === "HEAD" || responseType === "none") await response.body?.cancel?.();
    else if (!response.body?.getReader && !response.text && response.json && responseType === "json") body = await response.json();
    else {
      let text;
      if (options.readResponseBody) {
        const bytes = await options.readResponseBody(response, { maxBytes: boundedBodyLimit(request.maxBodyBytes), signal });
        evidence.bodyBytes = bytes.byteLength;
        evidence.bodyDigest = { algorithm: "sha256", representation: "received-identity-bytes", value: createHash("sha256").update(bytes).digest("hex") };
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { throw Object.assign(new Error("response-not-utf8"), { code: "REPRESENTATION_UNREAD" }); }
      } else text = await boundedBody(response, boundedBodyLimit(request.maxBodyBytes));
      body = responseType === "json" && response.ok ? JSON.parse(text) : text;
    }
    return finish({ ...evidence, status: response.ok ? "witness" : "obstruction", body,
      ...(response.ok ? {} : { reason: `HTTP ${response.status}` }) }, clock());
  } catch (error) {
    if (response?.body && !response.body.locked) void response.body.cancel?.().catch?.(() => {});
    return finish({ ...evidence, status: "obstruction", bodyTruncated: ["BODY_LIMIT", "body-too-large", "REPRESENTATION_UNREAD"].includes(error?.code),
      reason: signal.aborted ? "operation-timeout" : options.safeErrors ?
        ["BODY_LIMIT", "body-too-large"].includes(error?.code) ? "response-body-limit" :
          error?.code === "REPRESENTATION_UNREAD" ? "response-representation-unread" : "operation-failed"
        : error instanceof Error ? error.message : String(error) }, clock());
  } finally { clearTimeout(timeout); }
}

function finish(value, completedAt) {
  return Object.freeze({ ...value, id: `http-observation:${randomUUID()}`, completedAt });
}
async function boundedBody(response, limit) {
  const chunks = [], reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw bodyLimit();
    return text;
  }
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw bodyLimit(); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}
function bodyLimit() { return Object.assign(new Error("response-body-limit"), { code: "BODY_LIMIT" }); }
function boundedBodyLimit(value) { return Number.isInteger(value) && value > 0 ? Math.min(value, 2_097_152) : 262_144; }
function boundedTimeout(value) { const parsed = Number(value); return Number.isInteger(parsed) ? Math.max(1, Math.min(60_000, parsed)) : 5_000; }
function requiredMethod(value) { if (!METHODS.has(value)) throw new TypeError("method must be GET, HEAD, or POST"); return value; }
function requiredResponseType(value) { if (!RESPONSE_TYPES.has(value)) throw new TypeError("responseType must be json, text, or none"); return value; }
function requiredUrl(value) { const text = requiredText(value, "url"), url = new URL(text); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new TypeError("HTTP(S) URL without credentials or fragment required"); return text; }
function requiredText(value, name) { if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a nonempty string`); return value.trim(); }
