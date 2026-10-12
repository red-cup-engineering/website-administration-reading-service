export type ConformanceStatus = "conformant" | "nonconformant" | "unknown" | "not-applicable";
export interface SourceInput { path: string; text?: string; error?: string; kind?: string }
export interface Evidence { path?: string; kind?: string; line?: number; specifier?: string; symbol?: string }
export interface Issue { path: string; reason: string; code?: string; skipped?: number; truncated?: boolean }
export interface Scope { kind: string; version: number; includes: string; excludes: readonly string[]; evidence: string }
export interface WebSourceSnapshot { root: string; files: SourceInput[]; assets?: string[]; issues: Issue[]; scope?: Scope }
export interface Conformance { status: ConformanceStatus; reasons: string[]; evidence: Evidence[] }
export interface WebSourceRecord {
  path: string; owner: string | null; package: string | null;
  classification: "installed-dependency" | "generated-test-artifact" | "upstream-web-primitive" | "supporting-source" | "documentary-or-historical-source" | "test-fixture" | "generated-artifact" | "vendor-transport" | "deployment-or-generator-configuration" | "shared-engine" | "visible-development-frontend" | "authored-frontend" | "authored-server" | "reusable-codec-or-transport" | "unproven-activation";
  roleEvidence: Record<string, unknown> | null;
  frontend: boolean; server: boolean; signals: Evidence[]; producers: string[]; unknowns: string[];
  declaredImports: { specifier?: string; mode: string; name?: string; typeOnly: boolean }[];
  activation: { status: "declared" | "unproven"; chain: {path: string; relation: string}[]; references: {path: string; relation: string; script?: string}[]; installed: "unobserved"; published: "unobserved"; live: "unobserved" };
  frontendConformance: Conformance; serverConformance: Conformance; status: ConformanceStatus;
}
export interface WebConformanceReport {
  kind: "website-administration.web-conformance"; schemaVersion: 1; root: string; scope: Scope;
  summary: { requiredFrontendRecords: number; requiredServerRecords: number; filesRead: number; packagesRead: number; records: number; frontendRecords: number; serverRecords: number; byClassification: Record<string, number>; byStatus: Partial<Record<ConformanceStatus, number>>; discoveryIssues: number };
  diagnostics: {path: string; reason: string}[];
  issues: Issue[]; records: WebSourceRecord[];
  migrations: {path: string; owner: string | null; package: string | null; receiver: string; capability: "frontend" | "server" | "evidence"; status: ConformanceStatus; actions: string[]}[];
  families: { owner: string | null; package: string | null; receiver: string; files: string[]; actions: string[] }[];
  observations: {path: string; role: string}[];
  complete: boolean;
}
export declare const WEB_SOURCE_SCOPE: Scope;
export declare function readWebSourceSnapshot(root: string, adapters?: {walk?: Function; read?: Function}): WebSourceSnapshot;
export declare function projectWebConformance(snapshot: WebSourceSnapshot): WebConformanceReport;
export declare function readWebConformance(root: string, adapters?: {walk?: Function; read?: Function}): WebConformanceReport;
