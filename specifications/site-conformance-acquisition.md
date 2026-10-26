# Site conformance acquisition contract

## Required outcome and original owners

An authorized site observer must obtain current evidence for an installed finite
route cover and return it through the existing conformance contract. Passing a
caller-authored complete report into a new wrapper does not meet this requirement.

Website Administration owns source policy admission, exact request formation,
observation provenance and the conformance projection. The HTTP Services owner
owns public-address admission, pinned network transport and bounded byte reading.
Computer System Engine/Relating owns native operation execution; JSON Schema
owns its carried contracts. Serialization owns Link/header field parsing.
Web/Organizing owns provider discovery, original Work,
mail source custody, recurring turns and independently received outcomes.

The observed upstream contracts are `observeSiteOperation(request, options)`,
`projectSiteConformance(input)`, HTTP `authorizePublicHttpUrl`, HTTP
`readResponseBody(response, {maxBytes, signal})`, System `operation(spec)` and
JSON Schema `schemaFrom(schema)`. The existing HTTP `fetchWithPolicy` follows
redirects, while `acquireHttpResponse` retries or discards unsuccessful responses.
Neither can witness a source redirect or intentional refusal. The added HTTP
`fetchPublicHttpResponse` therefore returns the original response of one GET/HEAD
and pins the addresses admitted by the same original policy.

## Inputs and authority

`createSiteConformanceAcquirer(policy)` installs ordinary JSON source policy with
one HTTPS origin, owner, policy revision, route intentions and finite budgets.
The copied policy is immutable. A caller cannot change route URLs/methods,
budgets, HTTP headers, DNS, network implementation or returned observations.

`acquire(input)` accepts only site selection, original Google/Web evidence,
expected source/deployment coordinates and an optional release lower time bound.
The native `site-conformance-observe` operation accepts the same input. Current
host authority is checked before its first effect and before each subsequent
request. A denied/revoked operation produces no further observations.

Source/deployment coordinates in an input are expectations. Observed deployment
coordinates come only from the response. Missing or contradictory coordinates
prevent conformance. The response header itself remains provider testimony; the
original receiver must bind actual release provenance and independent producer
identity. A matching digest or hostname confers neither authority nor custody.

## Computation and guarantees

1. Admit all policy and evidence before network effects. Provider email URLs do
   not enter request formation.
2. Request the exact origin's GET `/robots.txt` and each source-declared distinct
   URL/method once, within shared request/time/byte bounds.
3. Require public initial resolution, pin the admitted answer, preserve TLS
   verification of the original host and refuse credentials. Do not follow
   redirects, retry errors or send mutation methods.
4. Read bounded identity-coded UTF-8 bytes with the same request deadline. Retain
   selected headers/status and repeated field boundaries after body failures;
   expose no raw exception text. Preserve X-Robots agent scope across separate
   fields and use the original Link parser for canonical parameter ordering.
5. Feed the observations into the existing pure projector. Fresh HTTP
   contradictions can be repair findings. Missing/stale/unbound/truncated
   observations remain investigation.
6. Preserve source-qualified Google notices and Web projection identities.
   Successful HTTP cannot resolve Google state, clear an email diagnosis,
   restart a provider quota period or authorize a site launch.
7. Return the original report shape plus bounded acquisition provenance. No new
   scheduler, journal, credential mechanism or Work registry is created.

The robots profile is deliberately conservative. It assesses exact current
robots bytes for index/alternate routes under a specified literal-prefix and
terminal-anchor profile. Unsupported wildcard rules are unknown, not permission.
Encoded literal special characters match their URI forms; the terminal anchor
retains its specificity. A nonterminal raw anchor remains unsupported. Canonical
Link metadata with unsupported/ambiguous syntax remains incomplete; foreign
anchor contexts never provide this response's canonical evidence.
The report explicitly excludes Google's cached state, rendering/accessibility,
unlisted routes, repairs, installation and actual indexing.

## Receiving tests

`test/site-conformance-acquisition.test.mjs` starts a real local HTTP fixture and
executes the original HTTP response adapter, byte reader, operation observer and
projector. Its transport dependency maps the admitted test hostname to that
ephemeral fixture; production defaults have no such override. Tests retain exact
method/query, source redirects and intentional 503; distinguish actual robots
and noindex defects; keep absent release headers unknown; carry property-only
Google notices and original Web quota episodes; refuse caller-supplied reports
and destinations; retain original repeated X-Robots field scope while excluding
cookies; and exercise real stalled/oversized/invalid response streams.

`test/site-conformance-application.test.mjs` uses the actual received Computer
System Engine/Relating and JSON Schema constructors, tests native schema
admission, multiple site identities, current authority revocation, actual local
HTTP acquisition, and the default transport's private-address refusal.

The HTTP owner's `test/public-response.test.mjs` witnesses one DNS resolution
bound to the socket lookup, all-address public admission, credential/header and
private/transition-address refusals, exact redirect/failure responses, HEAD,
resolution timeout and response-stream timeout. Existing original fetch-policy
and reader observation/conformance regressions remain in the qualification run.

These tests establish source behavior within their specified local fixture and
received dependency closure. They do not establish full source/AST installation,
package publication, deployed monitoring or production conformance.
