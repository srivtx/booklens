#!/usr/bin/env bun
import { audit } from "./audit";
import { fixEpub } from "./fix";
import { writeSarif } from "./sarif";
import { RULE_CODES } from "./rules";
import { EpubReadError } from "./errors";
import { readEpub } from "./zip";
import { assertReadableEpub } from "./opf";
import type { AuditResult, FixResult, Issue, Severity } from "./types";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;

const USAGE = `booklens ${VERSION}

Usage:
  booklens audit <file> [options]
  booklens fix <file> [options]

Commands:
  audit <file>        Report accessibility issues in an EPUB.
  fix <file>          Write a repaired EPUB (default: <input>.fixed.epub).

Options:
  -o <path>           fix: output path (default: <input>.fixed.epub)
  --json              audit: print the full result as JSON
  --sarif <path>      Write a SARIF 2.1.0 report to <path>
  --fail-on <level>   Exit 1 at or above this severity: error (default),
                      warning, info, or none
  --language <lang>   fix: language to write when one is missing (default: en)
  --title <title>     fix: title to write when one is missing
  --only <codes>      fix: comma-separated rule codes to apply
                      (e.g. --only E001,E002,W010)
  --dry-run           fix: report changes without writing a file
  -v, --version       Print the version and exit
  -h, --help          Print this help and exit

Exit codes:
  0  success; no findings at or above --fail-on
  1  findings at or above --fail-on, or invalid arguments
  2  the input could not be read or is not a valid EPUB

Examples:
  booklens audit book.epub
  booklens audit book.epub --json --sarif booklens.sarif
  booklens fix book.epub -o book.fixed.epub --language en --title "My Book"
  booklens fix book.epub --only E001,E002 --dry-run`;

const KNOWN_CODES = new Set<string>(RULE_CODES as readonly string[]);

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

interface ParsedOnly {
  codes?: string[];
  error?: string;
}

function parseOnly(value: string | boolean | undefined): ParsedOnly {
  if (value === undefined) return {};
  if (typeof value !== "string" || value.trim() === "") {
    return { error: "--only requires at least one rule code (e.g. --only E001,E002)." };
  }
  const codes = value
    .split(/[,\s]+/)
    .map((code: string) => code.trim().toUpperCase())
    .filter((code: string) => code.length > 0);
  if (codes.length === 0) {
    return { error: "--only requires at least one rule code (e.g. --only E001,E002)." };
  }
  const unknown = codes.filter((code) => !KNOWN_CODES.has(code));
  if (unknown.length > 0) {
    return {
      error: `Unknown rule code(s): ${unknown.join(", ")}. Known codes: ${[...KNOWN_CODES].join(", ")}.`,
    };
  }
  return { codes };
}

function validateSingleInput(positional: string[]): string | undefined {
  if (positional.length === 0) {
    console.error(USAGE);
    return undefined;
  }
  if (positional.length > 1) {
    console.error(
      `Unexpected extra argument(s): ${positional.slice(1).join(", ")}. Provide exactly one input file.`,
    );
    return undefined;
  }
  return positional[0];
}

function sarifError(flags: Map<string, string | boolean>): string | undefined {
  if (!flags.has("sarif")) return undefined;
  const value = flags.get("sarif");
  if (typeof value !== "string" || value.trim() === "") {
    return "--sarif requires a non-empty output path.";
  }
  return undefined;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A readable ZIP may still not be an EPUB. Treat a missing/unreadable
// container or package document as an I/O/parse failure (exit 2) rather than
// as an accessibility finding (exit 1).
function validateEpub(data: Uint8Array, file: string): number | undefined {
  try {
    assertReadableEpub(readEpub(data));
    return undefined;
  } catch (error) {
    if (error instanceof EpubReadError) {
      console.error(`Cannot parse ${file}: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

function wantsVersion(flags: Map<string, string | boolean>): boolean {
  return flags.get("version") === true || flags.get("v") === true;
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

  const sarifIssue = sarifError(flags);
  if (sarifIssue !== undefined) {
    console.error(sarifIssue);
    return 1;
  }

  const file = validateSingleInput(positional);
  if (file === undefined) return 1;

  let data: Uint8Array;
  try {
    data = await readBytes(file);
  } catch (error) {
    console.error(`Cannot read ${file}: ${errorMessage(error)}`);
    return 2;
  }

  const invalidAudit = validateEpub(data, file);
  if (invalidAudit !== undefined) return invalidAudit;

  let result: AuditResult;
  try {
    result = audit(data, file);
  } catch (error) {
    if (error instanceof EpubReadError) {
      console.error(`Cannot parse ${file}: ${error.message}`);
      return 2;
    }
    throw error;
  }

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

  const sarifIssue = sarifError(flags);
  if (sarifIssue !== undefined) {
    console.error(sarifIssue);
    return 1;
  }

  const only = parseOnly(flags.get("only"));
  if (only.error !== undefined) {
    console.error(only.error);
    return 1;
  }

  const file = validateSingleInput(positional);
  if (file === undefined) return 1;

  let data: Uint8Array;
  try {
    data = await readBytes(file);
  } catch (error) {
    console.error(`Cannot read ${file}: ${errorMessage(error)}`);
    return 2;
  }

  const invalidFix = validateEpub(data, file);
  if (invalidFix !== undefined) return invalidFix;

  const language = flags.get("language");
  const title = flags.get("title");

  let result: FixResult;
  try {
    result = fixEpub(data, {
      ...(typeof language === "string" ? { language } : {}),
      ...(typeof title === "string" ? { title } : {}),
      ...(only.codes ? { only: only.codes } : {}),
    });
  } catch (error) {
    if (error instanceof EpubReadError) {
      console.error(`Cannot parse ${file}: ${error.message}`);
      return 2;
    }
    throw error;
  }

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
