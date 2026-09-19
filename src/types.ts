import type { UnzipLimits } from "./zip";

export type Severity = "error" | "warning" | "info";

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  location: string;
  wcag?: string;
  fixable: boolean;
}

export interface EpubFile {
  path: string;
  data: Uint8Array;
}

export interface EpubStore {
  files: EpubFile[];
  list(): string[];
  get(path: string): Uint8Array | undefined;
}

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

export interface SpineItem {
  idref: string;
  linear: boolean;
}

export interface OpfMetadata {
  title?: string;
  language?: string;
  identifier?: string;
  meta: Record<string, string>;
}

export interface Opf {
  path: string;
  dir: string;
  metadata: OpfMetadata;
  manifest: ManifestItem[];
  spine: SpineItem[];
  raw: string;
}

export interface NavDoc {
  path: string;
  isXhtml: boolean;
  hasLandmarks: boolean;
  hasToc: boolean;
  hasPageList: boolean;
  raw: string;
}

export interface AuditResult {
  file: string;
  issues: Issue[];
  counts: Record<Severity, number>;
}

export interface FixResult {
  data: Uint8Array;
  applied: string[];
  skipped: string[];
  remaining: Issue[];
}

export interface FixOptions {
  language?: string;
  title?: string;
  only?: string[];
  limits?: UnzipLimits;
}
