import type { AuditResult, Issue, Severity } from "./types";

const INFORMATION_URI = "https://github.com/srivtx/booklens";
const HELP_URI = "https://github.com/srivtx/booklens#rules";

export interface SarifRule {
  id: string;
  shortDescription: { text: string };
  helpUri: string;
  properties: { tags: string[] };
}

export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: {
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number };
    };
  }[];
  properties: { tags: string[] };
}

export interface SarifLog {
  version: "2.1.0";
  $schema: string;
  runs: {
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
  }[];
}

function toLevel(severity: Severity): "error" | "warning" | "note" {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "note";
}

function tagsFor(issue: Issue): string[] {
  return ["accessibility", ...(issue.wcag ? [`wcag-${issue.wcag}`] : [])];
}

function toResults(results: AuditResult[]): SarifResult[] {
  const out: SarifResult[] = [];
  for (const result of results) {
    for (const issue of result.issues) {
      out.push({
        ruleId: issue.code,
        level: toLevel(issue.severity),
        message: { text: issue.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: issue.location },
              region: { startLine: 1 },
            },
          },
        ],
        properties: { tags: tagsFor(issue) },
      });
    }
  }
  return out;
}

function toRules(results: AuditResult[]): SarifRule[] {
  const seen = new Map<string, Issue>();
  for (const result of results) {
    for (const issue of result.issues) {
      if (!seen.has(issue.code)) seen.set(issue.code, issue);
    }
  }
  return Array.from(seen.values()).map((issue) => ({
    id: issue.code,
    shortDescription: { text: issue.message },
    helpUri: HELP_URI,
    properties: { tags: tagsFor(issue) },
  }));
}

export function toSarif(
  results: AuditResult | AuditResult[],
  toolName: string,
  toolVersion: string,
): SarifLog {
  const list = Array.isArray(results) ? results : [results];
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            version: toolVersion,
            informationUri: INFORMATION_URI,
            rules: toRules(list),
          },
        },
        results: toResults(list),
      },
    ],
  };
}

export async function writeSarif(
  path: string,
  results: AuditResult | AuditResult[],
  toolName: string,
  toolVersion: string,
): Promise<void> {
  const log = toSarif(results, toolName, toolVersion);
  await Bun.write(path, JSON.stringify(log, null, 2));
}
