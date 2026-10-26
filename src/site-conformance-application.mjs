import {createSiteConformanceAcquirer} from './site-conformance-acquisition.mjs';
import {createHash} from 'node:crypto';

export const SITE_CONFORMANCE_OBSERVE_VERB = 'site-conformance-observe';
const text = {type:'string',minLength:1,maxLength:8192};
const inputSchema = site => ({$id:`website-administration/site-conformance-observe-input/v1/${createHash('sha256').update(site).digest('hex')}`,type:'object',
  additionalProperties:false,required:['site'],properties:{site:{type:'string',const:site},
    sourceContext:{type:'object',additionalProperties:false,required:['policyRevision'],properties:{policyRevision:text,sourceRevision:text,deploymentRevision:text}},
    notBefore:{type:'string',format:'date-time'},
    searchConsole:{type:'array',maxItems:256,items:{type:'object',additionalProperties:false,
      required:['id','property','observedAt','reason'],properties:{id:text,property:text,observedAt:{type:'string',format:'date-time'},reason:text,url:{anyOf:[text,{type:'null'}]},source:text}}},
    reportedEvidence:{type:'object',required:['schema','incidents'],properties:{schema:{const:'561.web-evidence-projection.v1'},incidents:{type:'array',maxItems:128}}}}});
const outputSchema = {$id:'website-administration/site-conformance-observe-output/v1',type:'object',
  required:['kind','schemaVersion','site','owner','sourceContext','evaluatedAt','records','findings','complete','acquisition'],
  properties:{kind:{const:'website-administration.site-conformance'},schemaVersion:{const:1},site:{type:'string'},owner:{type:'string'},
    sourceContext:{type:'object'},evaluatedAt:{type:'string',format:'date-time'},records:{type:'array'},findings:{type:'array'},
    complete:{type:'boolean'},acquisition:{type:'object'}}};

/** Native application composition. Only source imports supply the RPC/schema
 * constructors and optional test transport. Runtime instance JSON supplies the
 * installed route policy; invocation JSON never supplies provider functions.
 */
export function createSiteConformanceObservationApplication({operation,schemaFrom,acquisitionDependencies = {}} = {}) {
  if (typeof operation !== 'function' || typeof schemaFrom !== 'function') throw new TypeError('original operation and schema suppliers required');
  return Object.freeze({kind:'metroplat.application/v1',operations(binding,options) {
    if (typeof binding?.now !== 'function' || typeof options?.operationSurface !== 'function')
      throw new TypeError('native host clock and current operation surface required');
    if (!options.configuration || Object.keys(options.configuration).length !== 1 || !options.configuration.policy)
      throw new TypeError('installed application configuration must carry only source-owned policy');
    const policy = createSiteConformanceAcquirer(options.configuration.policy).policy;
    const surface = options.operationSurface, clock = binding.now;
    let nativeOperation;
    const execute = async (input,_arguments,context) => {
      const invocation = context?.invocation, subject = invocation?.subject;
      const current = async () => {
        if (binding.now !== clock || context?.invocation !== invocation || context?.kind !== 'metroplat.rpc.execution-context' ||
            invocation?.kind !== 'metroplat.rpc.invocation' || !invocation.id || !invocation.request ||
            typeof subject !== 'string' || !subject.trim() || subject === 'anonymous' || invocation.subject !== subject ||
            invocation.operation !== nativeOperation.ref || invocation.verb !== nativeOperation.verb ||
            context.operation?.ref !== nativeOperation.ref || input?.site !== policy.site || invocation.input?.site !== policy.site ||
            JSON.stringify(input) !== JSON.stringify(invocation.input) ||
            !held(context.decision,invocation,nativeOperation))
          throw new TypeError('original authenticated site observation invocation required');
        const installed = await surface();
        const matches = installed?.operations?.filter(value => value.ref === nativeOperation.ref && value.verb === nativeOperation.verb);
        if (matches?.length !== 1 || typeof installed.authorize !== 'function') throw new TypeError('site observation is no longer uniquely installed');
        const decision = await installed.authorize(invocation,matches[0],clock.call(binding));
        if (!held(decision,invocation,nativeOperation)) throw new TypeError('current original site observation authority required');
      };
      await current();
      return createSiteConformanceAcquirer(policy,{...acquisitionDependencies,
        clock:() => clock.call(binding),beforeRequest:current}).acquire(input);
    };
    nativeOperation = operation({verb:SITE_CONFORMANCE_OBSERVE_VERB,inputFormat:'json',outputFormat:'json',
      domain:schemaFrom(inputSchema(policy.site)),codomain:schemaFrom(outputSchema),locus:'site',relation:'boundary',
      summary:'Acquire bounded exact public HTTP and robots evidence for an installed site policy.',
      description:'Fetches the source-owned route cover and robots.txt through original public HTTP policy; preserves original Google and Web reports as unresolved evidence. It does not deploy or claim Google indexing.',
      effects:{class:'external',replay:'coordinated',coordination:'coordination-required',deterministic:'unmeasured',totality:'schema-bounded'},run:execute});
    if (!nativeOperation?.ref || nativeOperation.verb !== SITE_CONFORMANCE_OBSERVE_VERB || typeof nativeOperation.execute !== 'function')
      throw new TypeError('original supplier did not return a native observation operation');
    return Object.freeze([nativeOperation]);
  }});
}
function held(decision,invocation,operation) {
  return decision?.ok === true && decision.reading === 'held' && decision.invocation === invocation.id &&
    decision.operation === operation.ref && decision.subject === invocation.subject;
}

/** Actual instance operationSources entrypoint; no caller-authored adapter ports. */
export async function siteConformanceObservationOperations(binding,options) {
  const [rpc,schemas] = await Promise.all([
    import('@red-cup-engineering/computer-system-engine/rpc/operation'),
    import('@red-cup-engineering/json-schema-services-section/contracts')
  ]);
  return createSiteConformanceObservationApplication({operation:rpc.operation,schemaFrom:schemas.schemaFrom}).operations(binding,options);
}
export const application = Object.freeze({kind:'metroplat.application/v1',operations:siteConformanceObservationOperations});
