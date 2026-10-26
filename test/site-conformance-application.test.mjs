import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer,request} from 'node:http';
import {operation} from '@red-cup-engineering/computer-system-engine/rpc/operation';
import {schemaFrom} from '@red-cup-engineering/json-schema-services-section/contracts';
import {fetchPublicHttpResponse} from '@red-cup-engineering/http-services-section/public-response';
import {createSiteConformanceObservationApplication,siteConformanceObservationOperations,SITE_CONFORMANCE_OBSERVE_VERB} from '../src/site-conformance-application.mjs';

const site = 'https://public.example/', now = '2026-10-26T02:00:00.000Z';
const policy = {site,owner:'site-owner',sourceContext:{policyRevision:'policy-1'},routes:[{url:site,method:'GET',intent:'index'}]};
const held = (invocation,op) => ({ok:true,reading:'held',invocation:invocation.id,operation:op.ref,subject:invocation.subject});
function contextFor(op,input = {site}) {
  const invocation = {kind:'metroplat.rpc.invocation',id:'invocation:test',request:'request:test',subject:'actor:reader',operation:op.ref,verb:op.verb,input};
  return {kind:'metroplat.rpc.execution-context',invocation,operation:op,decision:held(invocation,op)};
}

test('actual original native operation/schema constructors execute acquisition against a real HTTP fixture',async t => {
  const requests = [], server = createServer((req,res) => {
    requests.push(req.url);
    res.writeHead(200,{'content-type':req.url === '/robots.txt' ? 'text/plain' : 'text/html'});
    res.end(req.url === '/robots.txt' ? 'User-agent: *\nAllow: /\n' : '<html><head></head><body>Site</body></html>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections();server.close(resolve);}));
  const fetchResponse = (url,init) => fetchPublicHttpResponse(url,init,{resolveHost:async () => ['1.1.1.1'],
    requestImpl:(url,options,callback) => request(new URL(url.pathname,`http://127.0.0.1:${server.address().port}`),{...options,lookup:undefined},callback)});
  const app = createSiteConformanceObservationApplication({operation,schemaFrom,acquisitionDependencies:{fetchResponse}});
  let installed,admissions = 0;
  const options = {configuration:{policy},operationSurface:async () => ({operations:installed,authorize:async (invocation,op) => {admissions++;return held(invocation,op);}})};
  installed = app.operations({now:() => now},options);
  assert.equal(installed.length,1);const [op] = installed;
  assert.equal(op.kind,'metroplat.action');assert.equal(op.verb,SITE_CONFORMANCE_OBSERVE_VERB);
  assert.equal(op.effects.class,'external');assert.equal(op.relation,'boundary');
  const input = {site}, report = await op.execute(input,{},contextFor(op,input));
  assert.equal(report.complete,true);assert.equal(report.acquisition.attempted,2);
  assert.deepEqual(requests,['/robots.txt','/']);assert.equal(admissions,3);
  await assert.rejects(async () => op.execute({site,observations:[]},{},contextFor(op,{site,observations:[]})));
  assert.equal(requests.length,2);
});
test('actual native entrypoint loads original suppliers and the default transport refuses private targets',async () => {
  const privateSite = 'https://127.0.0.1/';let installed;
  const options = {configuration:{policy:{...policy,site:privateSite,routes:[{url:privateSite,intent:'index'}]}},
    operationSurface:async () => ({operations:installed,authorize:held})};
  installed = await siteConformanceObservationOperations({now:() => now},options);
  const [op] = installed,input = {site:privateSite};
  const report = await op.execute(input,{},contextFor(op,input));
  assert.equal(report.complete,false);assert.equal(report.acquisition.attempted,2);
  assert.ok(report.acquisition.observations.every(value => value.httpStatus === null));
});
test('missing original actor authority or revoked current admission refuses before another observation',async () => {
  let fetches = 0,installed,admissions = 0,revoked = false;
  const app = createSiteConformanceObservationApplication({operation,schemaFrom,acquisitionDependencies:{fetchResponse:async () => {
    fetches++;return new Response('User-agent: *\nAllow: /\n',{headers:{'content-type':'text/plain'}});
  }}});
  const options = {configuration:{policy},operationSurface:async () => ({operations:installed,authorize:(invocation,op) => {
    admissions++;return revoked || admissions > 2 ? {ok:false} : held(invocation,op);
  }})};
  installed = app.operations({now:() => now},options);const [op] = installed;
  const anonymous = contextFor(op);anonymous.invocation.subject = 'anonymous';
  await assert.rejects(op.execute({site},{},anonymous),/authenticated/);assert.equal(fetches,0);
  await assert.rejects(op.execute({site},{},contextFor(op)),/authority/);assert.equal(fetches,1);
  revoked = true;
  await assert.rejects(op.execute({site},{},contextFor(op)),/authority/);assert.equal(fetches,1);
});
