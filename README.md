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

### Receiving and dependency scope

A consumer can use `report.findings` to commission the existing repair provider,
then retain the original finding through an independently performed, exact-route
reinspection. This module does not hire, charge, release, or mutate anything.
Provider selection, Work identity, budgets, and receiving remain with their
existing owners.

The operation and site-conformance modules use only Node built-ins. The existing
source/AST analyzer additionally requires the declared workspace providers and
TypeScript. The repository's inherited package lock still refers to the older
path-walking provider; passing the dependency-free checks does not qualify that
unreconciled source-analysis installation.

The contract follows Google's distinction between intended exclusions and actual
indexing errors: <https://support.google.com/webmasters/answer/7440203?hl=en>.
