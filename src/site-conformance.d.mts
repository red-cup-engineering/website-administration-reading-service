export type SiteConformanceStatus = "conformant" | "nonconformant" | "unknown";
export type RouteIntent = "index" | "exclude" | "redirect" | "alternate" | "gone" | "unknown";
export interface SourceContext { policyRevision: string; sourceRevision?: string; deploymentRevision?: string; [key: string]: unknown }
export interface RoutePolicy { url: string; method?: "GET" | "HEAD"; intent: RouteIntent; expectedStatusCodes?: number[]; canonicalUrl?: string }
export interface SiteObservation {
  id: string; url: string; method: "GET" | "HEAD"; observedAt: string; completedAt?: string; source?: string;
  httpStatus?: number | null; status?: "witness" | "obstruction"; reason?: string;
  headers?: Record<string, string>; body?: unknown; bodyTruncated?: boolean;
  headerValues?: Record<string, string[]>;
  finalUrl?: string | null; redirected?: boolean; deploymentRevision?: string | null;
  bodyBytes?: number; bodyDigest?: { algorithm: "sha256"; representation: "received-identity-bytes"; value: string };
}
export interface SearchConsoleEvidence { id: string; property: string; observedAt: string; reason: string; url?: string | null; source?: string }
export interface SiteConformanceInput {
  site: string; owner: string; sourceContext: SourceContext; evaluatedAt: string; maxAgeMs?: number;
  routes: RoutePolicy[]; observations: SiteObservation[]; searchConsole?: SearchConsoleEvidence[];
  robotsUserAgent?: "Googlebot";
  reportedEvidence?: WebEvidenceProjection;
  reportedTargets?: string[];
}
export interface WebEvidenceProjection {
  schema: "561.web-evidence-projection.v1"; asOf?: string | null;
  incidents: { incidentId: string; target: string; family: string; status?: string;
    evidence: { incidentId: string; target: string; family: string; evidenceId: string; observedAt: string;
      kind: "reported" | "provider-notice" | "independent-probe"; result: "fail" | "pass" | "warning" | "unknown";
      delivery: {digest: string; channel: string; receivedAt: string}; [key: string]: unknown }[];
    [key: string]: unknown }[];
  [key: string]: unknown;
}
export interface SiteEvidenceReference {
  id: string; source: string; observedAt: string; completedAt?: string; url?: string; method?: string; property?: string;
  httpStatus?: number | null; deploymentRevision?: string | null;
}
export interface SiteConformanceFinding {
  id: string; code: string; status: "nonconformant" | "unknown"; action: "repair" | "investigate";
  site: string; url: string | null; method: "GET" | "HEAD" | null; owner: string;
  expected: unknown; observed: unknown; evidence: SiteEvidenceReference[]; sourceContext: SourceContext;
}
export interface SiteConformanceReport {
  kind: "website-administration.site-conformance"; schemaVersion: 1; site: string; owner: string;
  sourceContext: SourceContext; evaluatedAt: string; maxAgeMs: number;
  scope: { origin: string; routes: { url: string; method: "GET" | "HEAD" }[]; evidence: string; excludes: string[];
    robots?: { userAgent: "Googlebot"; profile: "literal-prefix-and-terminal-anchor" } };
  records: (RoutePolicy & { method: "GET" | "HEAD"; observation: SiteEvidenceReference | null; status: SiteConformanceStatus;
    checks: { code: string; status: SiteConformanceStatus; expected: unknown; observed: unknown; evidence: SiteEvidenceReference[] }[] })[];
  findings: SiteConformanceFinding[];
  providerNotices: { id: string; property: string; url: string | null; reason: string; classification: "expected" | "unbound" | "stale" | "unresolved"; evidence: SiteEvidenceReference[]; sourceContext: SourceContext }[];
  reportedEvidence?: WebEvidenceProjection;
  summary: { routes: number; observations: number; findings: number; providerNotices: number; reportedIncidents?: number; byStatus: Record<string, number>; byAction: Record<string, number> };
  complete: boolean;
}
export declare function projectSiteConformance(input: SiteConformanceInput): SiteConformanceReport;
export declare const SITE_CONFORMANCE_LIMITS: Readonly<{ routes: 128; observations: 1024; searchConsole: 256; bodyBytes: 2097152; totalBodyBytes: 33554432 }>;
