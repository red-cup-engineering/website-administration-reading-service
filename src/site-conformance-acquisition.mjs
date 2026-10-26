import {fetchPublicHttpResponse} from '@red-cup-engineering/http-services-section/public-response';
import {readResponseBody} from '@red-cup-engineering/http-services-section/body/web';
import {observeSiteOperation} from './site-operation-observation.mjs';
import {projectSiteConformance,admitReportedTargets} from './site-conformance.mjs';

export const SITE_ACQUISITION_LIMITS = Object.freeze({requests:129,timeoutMs:60_000,requestTimeoutMs:10_000,
  bodyBytes:2_097_152,totalBodyBytes:8_388_608,robotsBytes:512_000,inputBytes:1_048_576});
const DEFAULTS = Object.freeze({requests:129,timeoutMs:30_000,requestTimeoutMs:5_000,bodyBytes:262_144,totalBodyBytes:4_194_304,robotsBytes:512_000});

/** Install source-owned scope once. A request can select this exact site and
 * carry original evidence/expected release coordinates, but cannot widen URLs,
 * methods, headers, body limits, DNS or transport authority. */
export function createSiteConformanceAcquirer(rawPolicy, dependencies = {}) {
  const policy = installPolicy(rawPolicy);
  const fetchResponse = dependencies.fetchResponse ?? fetchPublicHttpResponse;
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const beforeRequest = dependencies.beforeRequest ?? (async () => {});
  for (const value of [fetchResponse,clock,beforeRequest]) if (typeof value !== 'function') throw new TypeError('installed acquisition dependency must be callable');
  return Object.freeze({policy,async acquire(rawInput = {site:policy.site}) {
    const input = copyJson(rawInput,'acquisition input');
    const allowed = new Set(['site','searchConsole','sourceContext','notBefore','reportedEvidence']);
    if (Object.keys(input).some(key => !allowed.has(key)) || input.site !== policy.site)
      throw new TypeError('acquisition input must select only the installed site and original evidence');
    const sourceContext = {...policy.sourceContext};
    if (input.sourceContext !== undefined) {
      record(input.sourceContext,'expected release context');
      if (Object.keys(input.sourceContext).some(key => !['policyRevision','sourceRevision','deploymentRevision'].includes(key)) ||
          input.sourceContext.policyRevision !== policy.sourceContext.policyRevision)
        throw new TypeError('expected release cannot replace the installed policy');
      for (const key of ['sourceRevision','deploymentRevision']) if (input.sourceContext[key] !== undefined)
        sourceContext[key] = nonempty(input.sourceContext[key],`expected ${key}`);
    }
    const startedAt = instant(clock());
    if (input.notBefore !== undefined && Date.parse(instant(input.notBefore)) > Date.parse(startedAt))
      throw new TypeError('inspection cannot precede the original release');
    // Admit evidence and the exact policy before any network effect. Provider
    // URLs are evidence only: they never enter the acquisition request list.
    projectSiteConformance({site:policy.site,owner:policy.owner,sourceContext,evaluatedAt:startedAt,
      routes:policy.routes,observations:[],searchConsole:input.searchConsole,maxAgeMs:policy.maxAgeMs,
      reportedEvidence:input.reportedEvidence,reportedTargets:policy.reportedTargets});
    const signal = AbortSignal.timeout(policy.limits.timeoutMs), observations = [];
    const robotsUrl = new URL('/robots.txt',policy.site).href;
    const requests = [{url:robotsUrl,method:'GET'},...policy.routes.filter(route => !(route.url === robotsUrl && route.method === 'GET'))];
    let retainedBytes = 0, attempted = 0, exhausted = null;
    const start = performance.now();
    for (const request of requests) {
      const remainingMs = Math.floor(policy.limits.timeoutMs - (performance.now() - start));
      const remainingBytes = policy.limits.totalBodyBytes - retainedBytes;
      if (attempted >= policy.limits.requests || remainingMs < 1 || signal.aborted || remainingBytes < 1) {
        exhausted = attempted >= policy.limits.requests ? 'request-budget' : remainingBytes < 1 ? 'body-budget' : 'deadline';
        break;
      }
      await beforeRequest({site:policy.site,url:request.url,method:request.method});
      const limit = Math.min(request.url === robotsUrl && request.method === 'GET' ? policy.limits.robotsBytes : policy.limits.bodyBytes,remainingBytes);
      const observation = await observeSiteOperation({endpoint:new URL(policy.site).hostname,url:request.url,method:request.method,
        responseType:request.method === 'HEAD' ? 'none' : 'text',redirect:'manual',
        timeoutMs:Math.min(remainingMs,policy.limits.requestTimeoutMs),maxBodyBytes:limit},
      {fetchImpl:fetchResponse,readResponseBody,clock,signal,safeErrors:true,identityContentCoding:true,
        userAgent:'red-cup-site-conformance/1 (+https://github.com/red-cup-engineering/website-administration-reading-service)'});
      attempted++;
      // Count a failed/partial read against its full admitted budget; failure
      // cannot be used to acquire unbounded data by resetting the byte counter.
      retainedBytes += observation.bodyBytes ?? (observation.httpStatus === null || request.method === 'HEAD' ? 0 : limit);
      observations.push(observation);
    }
    const evaluatedAt = instant(clock());
    const report = projectSiteConformance({site:policy.site,owner:policy.owner,sourceContext,evaluatedAt,
      routes:policy.routes,observations,searchConsole:input.searchConsole,maxAgeMs:policy.maxAgeMs,robotsUserAgent:'Googlebot',
      reportedEvidence:input.reportedEvidence,reportedTargets:policy.reportedTargets});
    return {...report,acquisition:{kind:'website-administration.site-acquisition',schemaVersion:1,startedAt,completedAt:evaluatedAt,
      limits:policy.limits,attempted,chargedBodyBytes:retainedBytes,exhausted,
      observations:observations.map(({body,...evidence}) => evidence),
      source:'https://github.com/red-cup-engineering/website-administration-reading-service',
      releaseBinding:'Expected revisions are requirements; only response evidence supplies observed deploymentRevision.'}};
  }});
}

export async function acquireSiteConformance(policy,input,dependencies) {
  return createSiteConformanceAcquirer(policy,dependencies).acquire(input);
}

function installPolicy(raw) {
  const policy = copyJson(raw,'installed site policy');
  record(policy,'installed site policy');
  if (Object.keys(policy).some(key => !['site','owner','sourceContext','routes','maxAgeMs','limits','reportedTargets'].includes(key))) throw new TypeError('unsupported installed policy field');
  const site = new URL(nonempty(policy.site,'site'));
  if (site.protocol !== 'https:' || site.username || site.password || site.hash || site.search || site.pathname !== '/' || site.href !== policy.site)
    throw new TypeError('installed site must be one canonical credential-free HTTPS origin');
  if (!Array.isArray(policy.routes) || !policy.routes.length || policy.routes.length > 128) throw new TypeError('nonempty finite source route policy required');
  policy.routes = policy.routes.map(route => ({...route,method:route.method ?? 'GET'}));
  const admitted = projectSiteConformance({site:policy.site,owner:policy.owner,sourceContext:policy.sourceContext,
    routes:policy.routes,observations:[],evaluatedAt:'2000-01-01T00:00:00.000Z',maxAgeMs:policy.maxAgeMs});
  policy.routes = admitted.records.map(({observation,checks,status,...route}) => route);
  policy.maxAgeMs = admitted.maxAgeMs;
  policy.sourceContext = {...admitted.sourceContext};
  if (policy.reportedTargets !== undefined) admitReportedTargets(policy.reportedTargets);
  if (Object.keys(policy.sourceContext).some(key => !['policyRevision','sourceRevision','deploymentRevision'].includes(key))) throw new TypeError('unsupported installed source context');
  for (const key of ['sourceRevision','deploymentRevision']) if (policy.sourceContext[key] !== undefined) nonempty(policy.sourceContext[key],key);
  const limits = policy.limits ?? {};
  record(limits,'acquisition limits');
  if (Object.keys(limits).some(key => !Object.hasOwn(DEFAULTS,key))) throw new TypeError('unsupported acquisition limit');
  policy.limits = {...DEFAULTS,...limits};
  for (const [key,value] of Object.entries(policy.limits)) if (!Number.isSafeInteger(value) || value < 1 || value > SITE_ACQUISITION_LIMITS[key])
    throw new RangeError(`invalid bounded ${key}`);
  return deepFreeze(policy);
}
function copyJson(value,label) {
  let bytes = 0;
  const visit = (value,seen = new Set(),depth = 0) => {
    bytes += typeof value === 'string' ? Buffer.byteLength(value) + 2 : 8;
    if (bytes > SITE_ACQUISITION_LIMITS.inputBytes || depth > 32) throw new RangeError(`${label} exceeds finite JSON budget`);
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || seen.has(value)) throw new TypeError(`${label} must be ordinary finite JSON`);
    seen.add(value);
    if (!Array.isArray(value)) record(value,label);
    else if (value.length > 4096 || Reflect.ownKeys(value).length !== value.length + 1) throw new RangeError(`${label} requires bounded dense JSON arrays`);
    if (!Array.isArray(value) && Reflect.ownKeys(value).length > 256) throw new RangeError(`${label} exceeds object field budget`);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      const property = Object.getOwnPropertyDescriptor(value,key);
      if (typeof key !== 'string' || !property.enumerable || !Object.hasOwn(property,'value')) throw new TypeError(`${label} must be ordinary finite JSON`);
      bytes += key.length;
      visit(property.value,seen,depth + 1);
    }
    seen.delete(value);
  };
  visit(value);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > SITE_ACQUISITION_LIMITS.inputBytes) throw new RangeError(`${label} exceeds byte budget`);
  return JSON.parse(encoded);
}
function record(value,label) { if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain record`); }
function nonempty(value,label) { if (typeof value !== 'string' || !value.trim() || value.length > 8192) throw new TypeError(`${label} required within text budget`); return value; }
function instant(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new TypeError('explicit acquisition timestamp required'); return value; }
function deepFreeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
