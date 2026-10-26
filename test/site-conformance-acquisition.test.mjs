import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer,request as nodeRequest} from 'node:http';
import {fetchPublicHttpResponse} from '@red-cup-engineering/http-services-section/public-response';
import {createSiteConformanceAcquirer,acquireSiteConformance} from '../src/site-conformance-acquisition.mjs';
import {projectSiteConformance} from '../src/site-conformance.mjs';
import {readRobotsAccess} from '../src/site-robots.mjs';

const site = 'https://public.example/';
const now = '2026-10-26T02:00:00.000Z';
const route = (path = '/',changes = {}) => ({url:new URL(path,site).href,method:'GET',intent:'index',...changes});
const policy = (changes = {}) => ({site,owner:'site-owner',sourceContext:{policyRevision:'policy-1'},routes:[route('/',{canonicalUrl:site})],...changes});
async function fixture(t,handler) {
  const calls = [], server = createServer((req,res) => {calls.push({method:req.method,url:req.url});handler(req,res);});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections();server.close(resolve);}));
  const port = server.address().port;
  const fetchResponse = (url,init) => fetchPublicHttpResponse(url,init,{
    resolveHost:async () => ['1.1.1.1'],
    requestImpl:(target,options,callback) => nodeRequest(new URL(target.pathname + target.search,`http://127.0.0.1:${port}`),{...options,lookup:undefined},callback)
  });
  return {calls,dependencies:{fetchResponse,clock:() => now}};
}
function serve(req,res,{robots = 'User-agent: *\nAllow: /\n',revision = 'release-1',html = '<html><head><link rel="canonical" href="/"></head><body>Site</body></html>'} = {}) {
  const headers = revision ? {'x-deployment-revision':revision} : {};
  if (req.url === '/robots.txt') {res.writeHead(200,{'content-type':'text/plain; charset=utf-8',...headers});res.end(robots);return;}
  if (req.url === '/old') {res.writeHead(301,{location:'/new',...headers});res.end();return;}
  if (req.url === '/casino') {res.writeHead(503,{'content-type':'text/plain','retry-after':'3600',...headers});res.end('not open');return;}
  if (req.url === '/private') {res.writeHead(200,{'x-robots-tag':'noindex',...headers});res.end();return;}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','set-cookie':'secret=value',...headers});res.end(html);
}
test('actual original HTTP streams produce a report for the exact installed cover, including redirects, refusal and HEAD',async t => {
  const {calls,dependencies} = await fixture(t,(req,res) => serve(req,res));
  const installed = policy({sourceContext:{policyRevision:'policy-1',deploymentRevision:'release-1'},routes:[
    route('/',{canonicalUrl:site}),route('/old',{intent:'redirect',canonicalUrl:new URL('/new',site).href}),
    route('/casino',{intent:'exclude',expectedStatusCodes:[503]}),route('/private',{method:'HEAD',intent:'exclude'})]});
  const report = await acquireSiteConformance(installed,{site},dependencies);
  assert.equal(report.complete,true);assert.equal(report.records.length,4);assert.equal(report.acquisition.attempted,5);
  assert.deepEqual(calls,[{method:'GET',url:'/robots.txt'},{method:'GET',url:'/'},{method:'GET',url:'/old'},{method:'GET',url:'/casino'},{method:'HEAD',url:'/private'}]);
  assert.equal(report.records.find(value => value.url.endsWith('/casino')).observation.httpStatus,503);
  assert.ok(report.records[0].checks.some(value => value.code === 'robots-access' && value.status === 'conformant'));
  const root = report.acquisition.observations.find(value => value.url === site);
  assert.equal(root.headers['set-cookie'],undefined);assert.equal(root.body,undefined);
  assert.equal(root.bodyDigest.algorithm,'sha256');assert.ok(root.bodyBytes > 20);
});
test('current blocked robots and raw noindex are actual route defects, while unsupported patterns stay unknown',async t => {
  for (const [robots,html,expected,status] of [
    ['User-agent: *\nDisallow: /\n',undefined,'robots-access','nonconformant'],
    ['User-agent: *\nAllow: /\n','<link rel="canonical" href="/"><meta name="robots" content="noindex">','indexing-directive','nonconformant'],
    ['User-agent: *\nDisallow: /*?private\n',undefined,'robots-access','unknown']
  ]) {
    const {dependencies} = await fixture(t,(req,res) => serve(req,res,{robots,html}));
    const report = await acquireSiteConformance(policy(),{site},dependencies);
    assert.equal(report.complete,false);assert.ok(report.findings.some(value => value.code === expected && value.status === status));
  }
});
test('expected release coordinates never become observed deployment evidence',async t => {
  const {dependencies} = await fixture(t,(req,res) => serve(req,res,{revision:null}));
  const report = await acquireSiteConformance(policy(),{site,sourceContext:{policyRevision:'policy-1',sourceRevision:'source-2',deploymentRevision:'release-2'},notBefore:now},dependencies);
  assert.equal(report.sourceContext.deploymentRevision,'release-2');
  assert.equal(report.complete,false);
  assert.ok(report.acquisition.observations.every(value => value.deploymentRevision === null));
  assert.ok(report.findings.some(value => value.code === 'deployment-revision-unbound' && value.action === 'investigate'));
});

test('real repeated X-Robots fields preserve Google scope and only admitted evidence headers reach the report',async t => {
  for (const [fields,complete] of [[['otherbot: index','noindex'],false],[['otherbot: index, noindex'],true]]) {
    const {dependencies} = await fixture(t,(req,res) => {
      if (req.url === '/robots.txt') return serve(req,res);
      res.setHeader('X-Robots-Tag',fields);
      return serve(req,res);
    });
    const report = await acquireSiteConformance(policy(),{site},dependencies);
    assert.equal(report.complete,complete);
    const root = report.acquisition.observations.find(value => value.url === site);
    assert.deepEqual(root.headerValues['x-robots-tag'],fields);
    assert.equal(root.headerValues['set-cookie'],undefined);
    assert.equal(JSON.stringify(report).includes('secret=value'),false);
    if (!complete) assert.ok(report.findings.some(value => value.code === 'indexing-directive' && value.status === 'nonconformant'));
  }
});
test('provider Google evidence remains original and never creates a request for the reported URL',async t => {
  const {calls,dependencies} = await fixture(t,(req,res) => serve(req,res));
  const notices = [{id:'property-only',property:'sc-domain:public.example',reason:'Blocked by robots.txt',observedAt:now},
    {id:'specific-original',property:'sc-domain:public.example',reason:'Server error (5xx)',observedAt:now,url:'https://public.example/unlisted?claim=yes'}];
  const report = await acquireSiteConformance(policy(),{site,searchConsole:notices},dependencies);
  assert.equal(report.complete,false);assert.deepEqual(calls.map(value => value.url),['/robots.txt','/']);
  assert.equal(report.providerNotices[0].url,null);assert.equal(report.providerNotices[1].url,notices[1].url);
  assert.ok(report.findings.every(value => value.action === 'investigate'));
});
test('wire inputs cannot provide reports, destinations, headers, transport, limits, or a replacement policy',async () => {
  let calls = 0;const reader = createSiteConformanceAcquirer(policy(),{fetchResponse:async () => {calls++;throw new Error('not called');}});
  for (const value of [{site,routes:[route('/other')]},{site,headers:{Authorization:'secret'}},{site,observations:[]},
    {site,report:{complete:true}},{site,limits:{requests:9999}},{site,fetchResponse:'arbitrary'},
    {site,sourceContext:{policyRevision:'another-policy',deploymentRevision:'release-2'}}]) await assert.rejects(reader.acquire(value));
  assert.equal(calls,0);
  const original = policy();const frozen = createSiteConformanceAcquirer(original);original.routes[0].url = 'https://attacker.example/';
  assert.equal(frozen.policy.routes[0].url,site);assert.equal(Object.isFrozen(frozen.policy.routes[0]),true);
});
test('request/body budgets retain missing coverage as unknown, and stream failure diagnostics expose no provider secret',async t => {
  const {calls,dependencies} = await fixture(t,(req,res) => serve(req,res));
  const report = await acquireSiteConformance(policy({routes:[route(),route('/second')],limits:{requests:1}}),{site},dependencies);
  assert.equal(calls.length,1);assert.equal(report.complete,false);assert.equal(report.acquisition.exhausted,'request-budget');
  assert.ok(report.findings.some(value => value.code === 'observation-missing'));
  const refused = await acquireSiteConformance(policy(),{site},{clock:() => now,fetchResponse:async () => {throw new Error('private-token-do-not-expose');}});
  assert.equal(refused.complete,false);assert.equal(JSON.stringify(refused).includes('private-token-do-not-expose'),false);
});
test('one original deadline bounds a real stalled body and truncation cannot become indexing success',async t => {
  const {dependencies} = await fixture(t,(req,res) => {
    if (req.url === '/robots.txt') return serve(req,res);
    res.writeHead(200,{'content-type':'text/html'});res.flushHeaders();res.write('<head>');
  });
  const started = performance.now();
  const report = await acquireSiteConformance(policy({limits:{timeoutMs:100,requestTimeoutMs:50}}),{site},dependencies);
  assert.ok(performance.now() - started < 1500);assert.equal(report.complete,false);
  assert.ok(report.acquisition.observations.some(value => value.reason === 'operation-timeout'));
});
test('a declared private-network destination is refused by the actual default transport',async () => {
  const privateSite = 'https://127.0.0.1/';
  const report = await acquireSiteConformance(policy({site:privateSite,routes:[{url:privateSite,method:'GET',intent:'index'}]}),{site:privateSite});
  assert.equal(report.complete,false);assert.ok(report.acquisition.observations.every(value => value.httpStatus === null));
});
test('the real acquisition CLI obtains an unknown private-target result without needing a fabricated report',async t => {
  const directory = await mkdtemp(join(tmpdir(),'site-acquisition-cli-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const privateSite = 'https://127.0.0.1/', path = join(directory,'policy.json');
  await writeFile(path,JSON.stringify(policy({site:privateSite,routes:[{url:privateSite,intent:'index'}]})));
  const cli = fileURLToPath(new URL('../scripts/acquire-site-conformance.mjs',import.meta.url));
  const result = spawnSync(process.execPath,[cli,path],{input:JSON.stringify({site:privateSite}),encoding:'utf8',timeout:5000});
  assert.equal(result.status,1,result.stderr);
  const report = JSON.parse(result.stdout);assert.equal(report.complete,false);assert.equal(report.acquisition.attempted,2);
  assert.ok(report.acquisition.observations.every(value => value.httpStatus === null));
});
test('invalid UTF-8, unsupported content coding and over-budget real streams preserve incomplete evidence',async t => {
  for (const mode of ['invalid-utf8','coding','charset','large']) {
    const {dependencies} = await fixture(t,(req,res) => {
      if (req.url === '/robots.txt') return serve(req,res);
      res.writeHead(200,{'content-type':mode === 'charset' ? 'text/html; charset=utf-16' : 'text/html',...(mode === 'coding' ? {'content-encoding':'gzip'} : {})});
      res.end(mode === 'invalid-utf8' ? Buffer.from([0xff,0xfe]) : '<html>' + 'x'.repeat(200));
    });
    const report = await acquireSiteConformance(policy({limits:{bodyBytes:64}}),{site},dependencies);
    assert.equal(report.complete,false,mode);
    const observed = report.acquisition.observations.find(value => value.url === site);
    assert.equal(observed.httpStatus,200);assert.equal(observed.bodyTruncated,true);
    assert.ok(report.findings.some(value => value.code === 'indexing-directive' && value.status === 'unknown'));
  }
});
test('robots groups, longest literal prefix, terminal anchor and percent encoding preserve intent',() => {
  const observation = body => ({url:new URL('/robots.txt',site).href,finalUrl:new URL('/robots.txt',site).href,httpStatus:200,headers:{'content-type':'text/plain'},body});
  const body = 'User-agent: *\nDisallow: /\nUser-agent: Googlebot\nDisallow: /private\nAllow: /private/public\nUser-agent: googlebot\nDisallow: /exact$\nDisallow: /caf%C3%A9\n';
  for (const [path,allowed] of [['/',true],['/private/a',false],['/private/public/a',true],['/exact',false],['/exact/more',true],['/café',false]])
    assert.equal(readRobotsAccess(observation(body),new URL(path,site).href).allowed,allowed,path);
  assert.equal(readRobotsAccess(observation('User-agent: *\nDisallow: /\nAllow: /\n'),site).allowed,true);
  assert.equal(readRobotsAccess(observation('not robots rules'),site).allowed,null);
});
test('RFC9309 encoded literal special characters and anchored specificity cannot create a crawlability false pass',() => {
  const observation = body => ({url:new URL('/robots.txt',site).href,httpStatus:200,headers:{'content-type':'text/plain'},body});
  for (const [rules,path,allowed] of [
    ['Disallow: /path/file-with-a-%2A.html','/path/file-with-a-*.html',false],
    ['Disallow: /path/file-with-a-%2A.html','/path/file-with-a-%2a.html',false],
    ['Disallow: /path/foo-%24','/path/foo-$',false],
    ['Disallow: /path/foo-%24','/path/foo-%24',false],
    ['Allow: /private\nDisallow: /private$','/private',false],
    ['Allow: /private\nDisallow: /private$','/private/child',true],
    ['Allow: /$\nDisallow: /','/',true],
    ['Allow: /\nDisallow: /$','/',false],
    ['Disallow: /foo$bar','/foo$bar',null],
  ]) assert.equal(readRobotsAccess(observation(`User-agent: *\n${rules}\n`),new URL(path,site).href).allowed,allowed,`${rules} at ${path}`);
});
test('original Web incident and quota episode testimony remain bounded investigation, not repair instructions',async t => {
  const {dependencies,calls} = await fixture(t,(req,res) => serve(req,res));
  const incidentId = 'web:' + 'a'.repeat(24), evidenceId = 'sha256:' + 'b'.repeat(64), target = 'provider:cloudflare/kv';
  const original = {schema:'561.web-evidence-projection.v1',asOf:now,incidents:[{incidentId,target,family:'quota-put',status:'provider-period-ended-unverified',
    quotaEpisodes:[{id:'quota:old-episode',state:'period-ended-unverified',operation:'PUT',windowEnd:'2026-10-26T00:00:00.000Z'}],
    sourceDisposition:{decision:'claimed-resolved'},evidence:[{incidentId,target,family:'quota-put',kind:'provider-notice',result:'fail',probe:'provider-email',
      observedAt:'2026-10-25T21:24:50.000Z',evidenceId,delivery:{digest:'sha256:' + 'c'.repeat(64),channel:'fastmail',receivedAt:'2026-10-26T00:13:19.000Z'}}]}]};
  const report = await acquireSiteConformance(policy({reportedTargets:[target]}),{site,reportedEvidence:original},dependencies);
  assert.equal(report.complete,false);assert.equal(report.summary.reportedIncidents,1);
  const finding = report.findings.find(value => value.code.startsWith('reported-evidence-unresolved:'));
  assert.equal(finding.action,'investigate');assert.equal(finding.url,null);assert.equal(finding.evidence[0].id,evidenceId);
  assert.deepEqual(report.reportedEvidence,original);assert.equal(finding.observed.quotaEpisodes[0].state,'period-ended-unverified');
  assert.deepEqual(calls.map(value => value.url),['/robots.txt','/']);
  const second = projectSiteConformance({site,owner:'site-owner',sourceContext:{policyRevision:'policy-1'},evaluatedAt:now,routes:[route()],observations:[],reportedEvidence:original,reportedTargets:[target]});
  assert.equal(second.findings.find(value => value.code.startsWith('reported-evidence-unresolved:')).id,finding.id);
});

test('declared external estate reports become investigations without additional HTTP acquisition',async t => {
  const {dependencies,calls} = await fixture(t,(req,res) => serve(req,res));
  const target='https://casino.example/',incidentId='web:'+'d'.repeat(24),evidenceId='sha256:'+'e'.repeat(64);
  const original={schema:'561.web-evidence-projection.v1',asOf:now,incidents:[{incidentId,target,family:'availability',
    sourceDisposition:{decision:'intentionally-unavailable'},evidence:[{incidentId,target,family:'availability',
      kind:'reported',result:'unknown',probe:'mail-report',observedAt:now,evidenceId,
      delivery:{digest:'sha256:'+'f'.repeat(64),channel:'fastmail',receivedAt:now}}]}]};
  const report=await acquireSiteConformance(policy({reportedTargets:[target]}),{site,reportedEvidence:original},dependencies);
  const finding=report.findings.find(value=>value.code.startsWith('reported-evidence-unresolved:'));
  assert.equal(finding.action,'investigate');assert.equal(finding.url,null);
  assert.equal(finding.observed.target,target);assert.equal(finding.observed.reportedSourceDisposition.decision,'intentionally-unavailable');
  assert.deepEqual(calls.map(value=>value.url),['/robots.txt','/']);
  const unselected=projectSiteConformance({site,owner:'site-owner',sourceContext:{policyRevision:'policy-1'},evaluatedAt:now,
    routes:[route()],observations:[],reportedEvidence:original});
  assert.equal(unselected.summary.reportedIncidents,0);
  await assert.rejects(()=>acquireSiteConformance(policy({reportedTargets:['https://user:secret@casino.example/']}),{site},dependencies),/credential-free/);
});
