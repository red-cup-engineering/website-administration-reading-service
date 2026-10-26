import type {RoutePolicy,SearchConsoleEvidence,SiteConformanceReport,SiteObservation,WebEvidenceProjection} from './site-conformance.mjs';

export interface AcquisitionSourceContext {policyRevision:string; sourceRevision?:string; deploymentRevision?:string}
export interface AcquisitionLimits {requests:number;timeoutMs:number;requestTimeoutMs:number;bodyBytes:number;totalBodyBytes:number;robotsBytes:number}
export interface InstalledSitePolicy {
  site:string;owner:string;sourceContext:AcquisitionSourceContext;routes:RoutePolicy[];maxAgeMs?:number;
  limits?:Partial<AcquisitionLimits>;reportedTargets?:string[];
}
export interface SiteAcquisitionInput {
  site:string;searchConsole?:SearchConsoleEvidence[];reportedEvidence?:WebEvidenceProjection;
  sourceContext?:AcquisitionSourceContext;notBefore?:string;
}
export interface SiteAcquisitionReport extends SiteConformanceReport {
  acquisition:{kind:'website-administration.site-acquisition';schemaVersion:1;startedAt:string;completedAt:string;
    limits:AcquisitionLimits;attempted:number;chargedBodyBytes:number;exhausted:'request-budget'|'body-budget'|'deadline'|null;
    observations:Omit<SiteObservation,'body'>[];source:string;releaseBinding:string};
}
/** Process-local supplier seams, not invocation or instance JSON. Production
 * uses the original HTTP public-response/body exports without an override. */
export interface AcquisitionDependencies {
  fetchResponse?:(input:string,init:RequestInit)=>Promise<Response>;
  clock?:()=>string;
  beforeRequest?:(request:{site:string;url:string;method:'GET'|'HEAD'})=>Promise<void>|void;
}
export declare function createSiteConformanceAcquirer(policy:InstalledSitePolicy,dependencies?:AcquisitionDependencies):Readonly<{
  policy:Readonly<InstalledSitePolicy>;acquire(input?:SiteAcquisitionInput):Promise<SiteAcquisitionReport>;
}>;
export declare function acquireSiteConformance(policy:InstalledSitePolicy,input?:SiteAcquisitionInput,dependencies?:AcquisitionDependencies):Promise<SiteAcquisitionReport>;
export declare const SITE_ACQUISITION_LIMITS:Readonly<AcquisitionLimits & {inputBytes:number}>;
