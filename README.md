# website-administration-reading-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Reads nested website administration and exhaustive source evidence for shared web engine conformance.

## Site operation evidence and conformance

The source analyzer (`./web-conformance`) assesses authored code and configuration.
The separate `./site-conformance` export reconciles a **declared finite cover of
exact public URLs and HTTP methods** against supplied observations and Search
Console notices. It does not turn a homepage check into a whole-site certificate.

`projectSiteConformance(input)` is a pure projection. Its input carries:

- `site`, `owner`, and `sourceContext.policyRevision`; retain source and deployment
  revisions when known instead of claiming one from a hostname.
- `evaluatedAt`, `maxAgeMs` (default one day), and `routes`, each with a URL,
  `GET` or `HEAD`, and explicit `intent`: `index`, `exclude`, `redirect`,
  `alternate`, `gone`, or `unknown`. Optional `canonicalUrl` declares a required
  overlap with another representation. `expectedStatusCodes` allows a declared
  excluded prelaunch route to retain, for example, HTTP 503.
- `observations`, retaining their original ID, URL, method, observation timestamp,
  HTTP status, selected headers, body or truncation marker, and observed deployment
  revision. A required deployment revision must match the response evidence.
- `searchConsole` notices with original evidence ID, property, time, reason and
  affected URL **only when the provider actually supplied that URL**.

The output is `website-administration.site-conformance` schema version 1. It
retains source context, exact route cover, per-route checks, and stable findings.
Finding IDs depend on site, URL, method and check code, so another observation of
one unresolved defect does not create a new defect identity. Each finding carries
its expectation, observation, evidence references, and `repair` or `investigate`
action. Current exact-response contradictions can request repair. Missing, stale,
future, conflicting, revision-unbound, or redirected-away evidence requires
investigation. Provider notices retain an explicit expected/unbound/stale/unresolved
disposition even when no repair is needed.

Admission is bounded to 128 routes, 1,024 observations, 256 provider notices,
2 MiB per observation body, and 32 MiB total body text. `site` identifies one
HTTP origin (a bare hostname defaults to HTTPS); every declared route must belong
to that origin. Search Console domain and URL-prefix properties must actually
cover the reported URL. Foreign property evidence remains unbound. An excluded
HTTP 200 response needs observed noindex evidence; absence of that evidence is
unknown rather than an assumed successful exclusion.

Expected redirects, alternate canonicals, intentional exclusions and removed
routes are assessed against their declared intent. A Google domain-level notice
never becomes an invented affected URL. A successful HTTP request does not close
an unresolved Google report. `complete` covers only the declared checks; it does
not establish Google indexing, browser rendering, accessibility, or the unlisted
parts of a site. Robots.txt rule interpretation requires a separate source-qualified
route observation. The raw-response check recognizes conventional server-delivered
robots metadata and canonical links; it does not execute JavaScript.

### Existing command and probe adapter

Supply a conformance snapshot to the existing command, without network effects:

```sh
node scripts/observe-site-operation.mjs --conformance < site-observations.json
```

Exit status is 0 for the fully assessed declared cover, 2 for a current repair
finding, and 1 for remaining unknown evidence. Importing this script has no effects.

Without `--conformance`, the command still observes the single request supplied
on stdin. Set `responseType: "text"` for HTML or text, `"json"` for the existing
JSON interface, or `"none"` for status-only checks. `HEAD` is preserved and does
not attempt JSON parsing. `GET`, `HEAD`, and the existing explicit `POST` are the
only supported operation methods; unsupported methods are rejected instead of
silently becoming GET. Redirect handling defaults to `manual`, retaining the
source status and Location. Callers needing the previous redirect-following
behavior can explicitly request `redirect: "follow"`; conformance will not use a
followed target as proof of the source response.

`projectSiteOperationRequests(administration, { target: "public" })` selects the
public endpoint deliberately. With no target selection it preserves the existing
local-first choice. Origin-relative paths are resolved with URL semantics, fixing
the previous doubled slash when a public base already ended in `/`. Configuration
can declare `responseType` and `HEAD` without losing either in projection.

Observations retain status and response headers even for HTTP errors or body
failures. Bodies are limited to 256 KiB by default (`maxBodyBytes`, capped at 2 MiB),
and truncation remains an explicit obstruction. Response cookies are not retained.
A response's `x-deployment-revision` is provider-declared evidence, not a proof that
the reported source is actually installed. A probe is not automatically independent
of a repairer; the receiving owner must establish that relationship.

## Actual bounded site acquisition

`./site-conformance-acquisition` now supplies the original observations as well
as their interpretation. `createSiteConformanceAcquirer(installedPolicy)` returns
an `acquire(input)` service. The convenience function is
`acquireSiteConformance(installedPolicy, input)`. Neither requires a caller to
fabricate an observations array or a complete conformance report.

The installed policy is separate from invocation input:

```js
import { createSiteConformanceAcquirer } from
  '@red-cup-engineering/website-administration-reading-service/site-conformance-acquisition';

const reader = createSiteConformanceAcquirer({
  site: 'https://example.org/',
  owner: 'the-original-site-owner',
  sourceContext: { policyRevision: 'the-reviewed-policy-revision' },
  routes: [{ url: 'https://example.org/', method: 'GET', intent: 'index',
    canonicalUrl: 'https://example.org/' }],
});
const report = await reader.acquire({ site: 'https://example.org/' });
```

The policy is copied, admitted and frozen. It names one canonical credential-free
HTTPS origin and 1–128 exact GET/HEAD routes. Invocation input can select only
that site and carry `searchConsole`, `reportedEvidence`, `notBefore`, and expected
`sourceContext` revisions. It cannot supply URLs, HTTP headers, a transport,
observations, a replacement policy or increased budgets. A release expectation
is a requirement: it never becomes the response's observed deployment revision.
Absent or mismatched `x-deployment-revision` remains unknown. That header is
provider-declared evidence, not independent proof of source installation.

Acquisition fetches the same origin's `/robots.txt` once and each distinct
declared method/URL once. It calls the original HTTP owner's `./public-response`
transport and `./body/web` reader. The transport validates all resolved addresses
through the existing public-network policy, pins one admitted address to the
socket, retains the original TLS hostname, and never follows or retries a
redirect or failure response. Source 301 and intentional 503 responses remain
available to the existing projector. No cookie, authorization, proxy selection
or arbitrary request header is supplied by the caller.

Defaults are 129 requests, a 30-second total deadline, 5 seconds per request,
256 KiB per route body, 500 KiB for robots.txt, and 4 MiB total charged body bytes.
Source policy may reduce these or increase them only within the exported hard
bounds: 129 requests, 60 seconds total, 10 seconds per request, 2 MiB per route,
500 KiB robots and 8 MiB total. Reads are sequential. Failed/partial reads consume
their admitted byte budget; they cannot reset it. Unrequested remaining routes
stay missing/unknown. The request deadline also covers the response stream.
Unsupported content coding/charset, invalid UTF-8 and truncated bodies remain
explicitly unread. Provider exception text is not copied into the report.

The result is the same `website-administration.site-conformance` v1 report,
with an `acquisition` receipt retaining exact requests, response status, selected
headers, observation intervals, observed revisions, byte counts and SHA-256 of
received identity-coded bytes. Raw HTML is used by the projector but is not
embedded in the receipt. The operation does not create a second evidence store;
the existing receiving service owns custody of its original result.

Selected repeated response fields also retain their original field boundaries
as `headerValues`. This keeps a separate unscoped `X-Robots-Tag: noindex` from
being mistaken for another crawler's directive after Fetch joins the fields.
Without original boundaries, ambiguous scoped directives remain unknown. The
original Serialization owner's Link parser supplies parameter-order-independent
canonical relations; malformed/unsupported fields remain incomplete, and a Link
with another context's `anchor` does not establish this response's canonical.
These readings follow [Google's indexing directives](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)
and [RFC 8288](https://www.rfc-editor.org/rfc/rfc8288.html).

### Robots and reported evidence

The acquirer supplies a separate current GET robots observation and enables the
projector's `Googlebot` profile for index/alternate routes. This bounded profile
supports named/wildcard agent groups, merged matching groups, literal path
prefixes, longest-match/allow-tie precedence, percent-normalized URI octets and
a terminal `$` anchor, including its precedence over an unanchored prefix.
Percent-encoded literal `*` and `$` retain their URI meaning. Patterns containing
unescaped `*`, a nonterminal `$`, malformed text and other
unsupported syntax remain **unknown**. Redirected, stale, unavailable server
responses and revision-unbound robots evidence cannot create a crawlability
pass. Ordinary non-429 4xx responses have the explicit file-unavailable reading.
This is a conservative reading of the current response, not a claim about
Google's cached robots state or actual indexing. Its source contracts are
[RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) and
[Google's robots interpretation](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec).

Original Web intake projections can be carried as `reportedEvidence` with schema
`561.web-evidence-projection.v1`. The report retains the entire original
projection and evidence identities. Relevant same-origin incidents and explicitly
installed `reportedTargets: ['provider:…']` produce stable investigation findings.
At most 128 incidents and 1,024 evidence entries fit within the 1 MiB invocation
budget. Reported diagnoses, claimed source dispositions and quota windows cannot
order repairs, widen acquisition or clear unresolved evidence. A quota period
ending remains unverified; a domain-level Google notice still has no invented
affected URL. These claims remain separate from freshly observed HTTP defects.

### Native callable boundary and command

`./site-conformance-application` exports an actual `metroplat.application/v1`
manifest and `siteConformanceObservationOperations(binding, options)` for the
original host's operation-source composition. It imports the original Computer
System Engine `rpc/operation` and JSON Schema `contracts` suppliers and declares
`site-conformance-observe` as an external, coordinated boundary operation.

Install one source policy through `options.configuration = { policy }`. The
host supplies its original `binding.now` and `options.operationSurface`; it does
not supply a five-function fabricated observer bundle. The handler requires the
original authenticated execution context and rechecks current installed
operation authority before each HTTP request. Native schema admission rejects
caller-supplied observation/report fields. Distinct sites receive distinct input
schema identities. Discovery, Work acceptance, recurring attention and package
installation remain with their original owners.

The CLI selects a source policy file and reads only the evidence input on stdin:

```sh
node scripts/acquire-site-conformance.mjs installed-policy.json < evidence.json
```

Exit codes are 0 for complete declared checks, 2 for a current repair finding,
and 1 for remaining unknown evidence. Importing either command has no effects.

### Receiving and dependency scope

A consumer can use `report.findings` to commission the existing repair provider,
then retain the original finding through an independently performed, exact-route
reinspection. This module does not hire, charge, release, or mutate anything.
Provider selection, Work identity, budgets, and receiving remain with their
existing owners.

The operation observer uses Node built-ins. Site conformance consumes the original
Serialization 0.1.0 Link/header parser. The existing source/AST analyzer additionally
requires the declared workspace providers and TypeScript. The repository's
inherited package lock still refers to the older path-walking provider; these
bounded acquisition checks do not qualify that source-analysis installation.

The acquisition export additionally requires the qualified original HTTP source
with `./public-response`. Select its exact commit or a new original registry
artifact carrying that export; existing HTTP 0.6.5-dev.2 does not include it.
HTTP exports its authored modules directly and requires no build/prepare step.
Its original registry configuration is `https://registry.561.group/`; the
receiving install must preserve that registry for original transitive suppliers.
The native application also consumes Computer System Engine 0.1.16 and JSON
Schema 0.5.0. `npm run test:acquisition` exercises the original source and native
constructors. Source qualification does not publish an artifact, install a host,
schedule monitoring, submit Google validation or establish a production outcome.

The contract follows Google's distinction between intended exclusions and actual
indexing errors: <https://support.google.com/webmasters/answer/7440203?hl=en>.
