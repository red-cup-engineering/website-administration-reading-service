export function projectSiteOperationRequests(administration) {
  if (!administration || !Array.isArray(administration.packages)) throw new TypeError("administration must carry packages");
  return Object.freeze(administration.packages.flatMap((pkg) => pkg.endpoints.flatMap((endpoint) => endpoint.operations.map((operation) => Object.freeze({
    kind: "website-administration.operation-request",
    endpoint: endpoint.name,
    url: `${endpoint.localUrl ?? endpoint.publicUrl}${operation.path}`,
    method: operation.method,
    body: operation.body,
    timeoutMs: operation.timeoutMs,
  })))));
}

export async function observeSiteOperation(request, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedTimeout(request.timeoutMs));
  try {
    const response = await fetchImpl(requiredUrl(request.url), {
      method: request.method === "POST" ? "POST" : "GET",
      signal: controller.signal,
      headers: { Accept: "application/json", ...(request.method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(request.method === "POST" ? { body: JSON.stringify(request.body ?? {}) } : {}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Object.freeze({ endpoint: requiredText(request.endpoint, "endpoint"), url: request.url, status: "witness", body: await response.json() });
  } catch (error) {
    return Object.freeze({ endpoint: requiredText(request.endpoint, "endpoint"), url: request.url, status: "obstruction", reason: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timeout);
  }
}

function boundedTimeout(value) { const parsed = Number(value); return Number.isInteger(parsed) ? Math.max(1, Math.min(60_000, parsed)) : 5_000; }
function requiredUrl(value) { const text = requiredText(value, "url"); new URL(text); return text; }
function requiredText(value, name) { if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a nonempty string`); return value.trim(); }
