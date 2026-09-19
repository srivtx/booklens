import { audit } from "./audit";
import { fixEpub } from "./fix";
import { writeSarif } from "./sarif";
import type { Issue, Severity } from "./types";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;

const USAGE = `Usage:
  audit <file> [--json] [--sarif <path>] [--fail-on <error|warning|info|none>]
  fix <file> -o <out> [--language <lang>] [--title <title>] [--only CODES] [--dry-run] [--sarif <path>] [--fail-on <error|warning|info|none>]

Global:
  --version            Print the version and exit
  --help, -h           Print this usage and exit`;

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

type FailOn = "error" | "warning" | "info" | "none";

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (arg === "-o") {
      const value = args[i + 1];
      flags.set("o", value ?? "");
      if (value !== undefined) i += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags.set(arg.slice(2, eq), arg.slice(eq + 1));
        continue;
      }
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      flags.set(arg.slice(1), true);
      continue;
    }

    positional.push(arg);
  }

  return { positional, flags };
}

async function readBytes(path: string): Promise<Uint8Array> {
  const buffer = await Bun.file(path).arrayBuffer();
  return new Uint8Array(buffer);
}

function defaultOutputPath(input: string): string {
  return input.replace(/\.epub$/i, "") + ".fixed.epub";
}

function parseOnly(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const codes = value
    .split(/[,\s]+/)
    .map((code: string) => code.trim())
    .filter((code: string) => code.length > 0);
  return codes.length > 0 ? codes : undefined;
}

function countsOf(issues: Issue[]): Record<Severity, number> {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) {
    if (issue.severity === "error") counts.error += 1;
    else if (issue.severity === "warning") counts.warning += 1;
    else counts.info += 1;
  }
  return counts;
}

function resolveFailOn(value: string | boolean | undefined): FailOn | undefined {
  if (value === undefined || value === true) return "error";
  if (
    value === "error" ||
    value === "warning" ||
    value === "info" ||
    value === "none"
  ) {
    return value;
  }
  return undefined;
}

function shouldFail(counts: Record<Severity, number>, failOn: FailOn): boolean {
  if (failOn === "none") return false;
  if (failOn === "info") {
    return counts.error + counts.warning + counts.info > 0;
  }
  if (failOn === "warning") return counts.error + counts.warning > 0;
  return counts.error > 0;
}

async function sarifPath(
  flags: Map<string, string | boolean>,
): Promise<string | undefined> {
  const value = flags.get("sarif");
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

function wantsVersion(flags: Map<string, string | boolean>): boolean {
  return flags.get("version") === true;
}

function wantsHelp(flags: Map<string, string | boolean>): boolean {
  return flags.get("help") === true || flags.get("h") === true;
}

async function runAudit(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);

  if (wantsVersion(flags)) {
    console.log(VERSION);
    return 0;
  }
  if (wantsHelp(flags)) {
    console.log(USAGE);
    return 0;
  }

  const failOn = resolveFailOn(flags.get("fail-on"));
  if (failOn === undefined) {
    console.error("Invalid --fail-on value (expected error, warning, info, or none).");
    return 1;
  }

  const file = positional[0];
  if (!file) {
    console.error(USAGE);
    return 1;
  }

  const data = await readBytes(file);
  const result = audit(data, file);

  if (flags.get("json") === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const issue of result.issues) {
      console.log(
        `${issue.severity} ${issue.code} ${issue.location} ${issue.message}`,
      );
    }
  }

  const out = await sarifPath(flags);
  if (out !== undefined) {
    await writeSarif(out, result, pkg.name, VERSION);
  }

  return shouldFail(result.counts, failOn) ? 1 : 0;
}

async function runFix(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);

  if (wantsVersion(flags)) {
    console.log(VERSION);
    return 0;
  }
  if (wantsHelp(flags)) {
    console.log(USAGE);
    return 0;
  }

  const failOn = resolveFailOn(flags.get("fail-on"));
  if (failOn === undefined) {
    console.error("Invalid --fail-on value (expected error, warning, info, or none).");
    return 1;
  }

  const file = positional[0];
  if (!file) {
    console.error(USAGE);
    return 1;
  }

  const data = await readBytes(file);
  const language = flags.get("language");
  const title = flags.get("title");
  const only = parseOnly(flags.get("only"));

  const result = fixEpub(data, {
    ...(typeof language === "string" ? { language } : {}),
    ...(typeof title === "string" ? { title } : {}),
    ...(only ? { only } : {}),
  });

  for (const entry of result.applied) console.log(entry);
  console.log(`remaining: ${result.remaining.length}`);

  if (flags.get("dry-run") !== true) {
    const outFlag = flags.get("o");
    const out =
      typeof outFlag === "string" && outFlag.length > 0
        ? outFlag
        : defaultOutputPath(file);
    await Bun.write(out, result.data);
  }

  const remaining = {
    file,
    issues: result.remaining,
    counts: countsOf(result.remaining),
  };

  const out = await sarifPath(flags);
  if (out !== undefined) {
    await writeSarif(out, remaining, pkg.name, VERSION);
  }

  return shouldFail(remaining.counts, failOn) ? 1 : 0;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);

  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return 0;
  }
  if (command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }

  if (command === "audit") return runAudit(rest);
  if (command === "fix") return runFix(rest);

  console.error(USAGE);
  return 1;
}

if (import.meta.main) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
