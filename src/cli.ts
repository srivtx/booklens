#!/usr/bin/env bun
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
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
const PROG = "booklens";

const USAGE = `${PROG} ${VERSION}

Usage:
  ${PROG} audit <file> [options]
  ${PROG} audit --dir <path> [options]
  ${PROG} fix <file> [options]
  ${PROG} fix --dir <path> [options]

Commands:
  audit               Report accessibility issues in an EPUB.
  fix                 Write a repaired EPUB (default: <input>.fixed.epub).

Options:
  -o <path>           fix: output path (single input only)
  --dir <path>        Read every .epub in <path> (non-recursive, sorted)
  --json              Print machine-readable JSON; one object for a single
                      input, an array when reading more than one
  --quiet, -q         Print a single summary line per file
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

Every value flag also accepts --flag=value. A lone -- ends option parsing.
Unknown options are rejected.

Exit codes:
  0  success; no findings at or above --fail-on
  1  findings at or above --fail-on
  2  invalid usage, or a file that cannot be parsed as an EPUB
  3  an input file/directory or output report could not be read/written

Examples:
  ${PROG} audit book.epub
  ${PROG} audit book.epub --json --sarif ${PROG}.sarif
  ${PROG} audit --dir public --quiet --fail-on warning
  ${PROG} fix book.epub -o book.fixed.epub --language en --title "My Book"
  ${PROG} fix book.epub --only E001,E002 --dry-run`;

const KNOWN_CODES = new Set<string>(RULE_CODES as readonly string[]);

const VALUE_FLAGS = new Set([
  "--sarif",
  "--fail-on",
  "--language",
  "--title",
  "--only",
  "--dir",
]);

const BOOLEAN_FLAGS = new Set([
  "--json",
  "--dry-run",
  "--quiet",
  "--help",
  "--version",
]);

type FailOn = "error" | "warning" | "info" | "none";

class UsageError extends Error {}
class IoError extends Error {}

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

function takeValue(args: string[], index: number, flag: string): string {
  const next = args[index + 1];
  if (next === undefined || next.length === 0 || next.startsWith("-")) {
    throw new UsageError(`option ${flag} requires a value`);
  }
  return next;
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  let endOfOptions = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (endOfOptions) {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      endOfOptions = true;
      continue;
    }

    if (arg === "-o" || arg.startsWith("-o=")) {
      let value = arg.startsWith("-o=") ? arg.slice(3) : undefined;
      if (value === undefined) {
        value = takeValue(args, i, "-o");
        i += 1;
      }
      if (value.length === 0) throw new UsageError("option -o requires a value");
      flags.set("o", value);
      continue;
    }

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = eq === -1 ? arg : arg.slice(0, eq);
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);

      if (BOOLEAN_FLAGS.has(key)) {
        if (inline !== undefined) {
          throw new UsageError(`option ${key} does not take a value`);
        }
        flags.set(key.slice(2), true);
        continue;
      }

      if (VALUE_FLAGS.has(key)) {
        let value = inline;
        if (value === undefined) {
          value = takeValue(args, i, key);
          i += 1;
        }
        if (value.length === 0) {
          throw new UsageError(`option ${key} requires a value`);
        }
        flags.set(key.slice(2), value);
        continue;
      }

      throw new UsageError(`unknown option ${key}`);
    }

    if (arg.startsWith("-") && arg.length > 1) {
      if (arg === "-q") {
        flags.set("quiet", true);
        continue;
      }
      if (arg === "-v") {
        flags.set("version", true);
        continue;
      }
      if (arg === "-h") {
        flags.set("help", true);
        continue;
      }
      throw new UsageError(`unknown option ${arg}`);
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
    return { error: "--only requires at least one rule code (e.g. --only E001,E002)" };
  }
  const codes = value
    .split(/[,\s]+/)
    .map((code: string) => code.trim().toUpperCase())
    .filter((code: string) => code.length > 0);
  if (codes.length === 0) {
    return { error: "--only requires at least one rule code (e.g. --only E001,E002)" };
  }
  const unknown = codes.filter((code) => !KNOWN_CODES.has(code));
  if (unknown.length > 0) {
    return {
      error: `unknown rule code(s): ${unknown.join(", ")}. Known codes: ${[...KNOWN_CODES].join(", ")}`,
    };
  }
  return { codes };
}

function resolveInputs(
  positional: string[],
  flags: Map<string, string | boolean>,
): string[] {
  const dirFlag = flags.get("dir");
  if (dirFlag === undefined) {
    if (positional.length === 0) return [];
    if (positional.length > 1) {
      throw new UsageError(
        `unexpected extra argument(s): ${positional.slice(1).join(", ")} (expected exactly one input)`,
      );
    }
    return [positional[0] as string];
  }

  const dir = dirFlag as string;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    throw new IoError(`cannot read directory ${dir}: ${errorMessage(error)}`);
  }

  const inputs = [...positional];
  for (const name of entries
    .filter((entry) => entry.toLowerCase().endsWith(".epub"))
    .sort()) {
    inputs.push(join(dir, name));
  }
  return inputs;
}

function sarifPath(flags: Map<string, string | boolean>): string | undefined {
  const value = flags.get("sarif");
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function sumCounts(results: AuditResult[]): Record<Severity, number> {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const result of results) {
    counts.error += result.counts.error;
    counts.warning += result.counts.warning;
    counts.info += result.counts.info;
  }
  return counts;
}

function summaryLine(file: string, counts: Record<Severity, number>): string {
  return `${basename(file)}: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info`;
}

function issueLine(issue: Issue): string {
  return `${issue.severity} ${issue.code} ${issue.location} ${issue.message}`;
}

function resolveFailOn(
  value: string | boolean | undefined,
): FailOn | undefined {
  if (value === undefined) return "error";
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wantsVersion(flags: Map<string, string | boolean>): boolean {
  return flags.get("version") === true;
}

function wantsHelp(flags: Map<string, string | boolean>): boolean {
  return flags.get("help") === true;
}

// A readable ZIP may still not be an EPUB. Treat a missing/unreadable
// container or package document as a parse failure (exit 2) rather than as an
// accessibility finding (exit 1).
function assertEpub(data: Uint8Array): void {
  assertReadableEpub(readEpub(data));
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
    throw new UsageError(
      "invalid --fail-on value (expected error, warning, info, or none)",
    );
  }

  const only = parseOnly(flags.get("only"));
  if (only.error !== undefined) throw new UsageError(only.error);

  const inputs = resolveInputs(positional, flags);
  if (inputs.length === 0) throw new UsageError("no input file");

  const json = flags.get("json") === true;
  const quiet = flags.get("quiet") === true;
  const outPath = sarifPath(flags);

  const results: AuditResult[] = [];
  let hadIo = false;
  let hadParse = false;

  for (const file of inputs) {
    let data: Uint8Array;
    try {
      data = await readBytes(file);
    } catch (error) {
      console.error(`${PROG}: cannot read ${file}: ${errorMessage(error)}`);
      hadIo = true;
      continue;
    }

    let result: AuditResult;
    try {
      assertEpub(data);
      result = audit(data, file);
    } catch (error) {
      if (error instanceof EpubReadError) {
        console.error(`${PROG}: cannot parse ${file}: ${error.message}`);
        hadParse = true;
        continue;
      }
      throw error;
    }

    results.push(result);
    if (!json) {
      if (quiet) {
        console.log(summaryLine(file, result.counts));
      } else {
        for (const issue of result.issues) console.log(issueLine(issue));
      }
    }
  }

  if (json) {
    console.log(
      JSON.stringify(results.length === 1 ? results[0] : results, null, 2),
    );
  }

  if (outPath !== undefined) {
    try {
      await writeSarif(
        outPath,
        results.length === 1 ? (results[0] as AuditResult) : results,
        pkg.name,
        VERSION,
      );
    } catch (error) {
      console.error(`${PROG}: cannot write ${outPath}: ${errorMessage(error)}`);
      hadIo = true;
    }
  }

  if (hadIo) return 3;
  if (hadParse) return 2;
  return shouldFail(sumCounts(results), failOn) ? 1 : 0;
}

interface FixJson {
  file: string;
  applied: string[];
  skipped: string[];
  remaining: Issue[];
  counts: Record<Severity, number>;
  output?: string;
  dryRun: boolean;
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
    throw new UsageError(
      "invalid --fail-on value (expected error, warning, info, or none)",
    );
  }

  const only = parseOnly(flags.get("only"));
  if (only.error !== undefined) throw new UsageError(only.error);

  const inputs = resolveInputs(positional, flags);
  if (inputs.length === 0) throw new UsageError("no input file");

  const outFlag = flags.get("o");
  if (inputs.length > 1 && typeof outFlag === "string") {
    throw new UsageError("option -o can only be used with a single input");
  }

  const json = flags.get("json") === true;
  const quiet = flags.get("quiet") === true;
  const dryRun = flags.get("dry-run") === true;
  const outPath = sarifPath(flags);
  const language = flags.get("language");
  const title = flags.get("title");

  const results: FixJson[] = [];
  const remainingResults: AuditResult[] = [];
  let hadIo = false;
  let hadParse = false;

  for (const file of inputs) {
    let data: Uint8Array;
    try {
      data = await readBytes(file);
    } catch (error) {
      console.error(`${PROG}: cannot read ${file}: ${errorMessage(error)}`);
      hadIo = true;
      continue;
    }

    let result: FixResult;
    try {
      assertEpub(data);
      result = fixEpub(data, {
        ...(typeof language === "string" ? { language } : {}),
        ...(typeof title === "string" ? { title } : {}),
        ...(only.codes ? { only: only.codes } : {}),
      });
    } catch (error) {
      if (error instanceof EpubReadError) {
        console.error(`${PROG}: cannot parse ${file}: ${error.message}`);
        hadParse = true;
        continue;
      }
      throw error;
    }

    let output: string | undefined;
    if (!dryRun) {
      output =
        typeof outFlag === "string" && outFlag.length > 0
          ? outFlag
          : defaultOutputPath(file);
      try {
        await Bun.write(output, result.data);
      } catch (error) {
        console.error(
          `${PROG}: cannot write ${output}: ${errorMessage(error)}`,
        );
        hadIo = true;
        continue;
      }
    }

    const counts = countsOf(result.remaining);
    results.push({
      file,
      applied: result.applied,
      skipped: result.skipped,
      remaining: result.remaining,
      counts,
      ...(output !== undefined ? { output } : {}),
      dryRun,
    });
    remainingResults.push({ file, issues: result.remaining, counts });

    if (!json) {
      if (quiet) {
        console.log(
          `${basename(file)}: ${result.applied.length} applied, ${result.skipped.length} skipped, ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info`,
        );
      } else {
        for (const entry of result.applied) console.log(entry);
        for (const entry of result.skipped) console.log(`skipped: ${entry}`);
        console.log(`remaining: ${result.remaining.length}`);
      }
    }
  }

  if (json) {
    console.log(
      JSON.stringify(results.length === 1 ? results[0] : results, null, 2),
    );
  }

  if (outPath !== undefined) {
    try {
      await writeSarif(outPath, remainingResults, pkg.name, VERSION);
    } catch (error) {
      console.error(`${PROG}: cannot write ${outPath}: ${errorMessage(error)}`);
      hadIo = true;
    }
  }

  if (hadIo) return 3;
  if (hadParse) return 2;
  return shouldFail(sumCounts(remainingResults), failOn) ? 1 : 0;
}

async function run(argv: string[]): Promise<number> {
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

  if (command === undefined) throw new UsageError("missing command");
  if (command.startsWith("-")) throw new UsageError(`unknown option ${command}`);
  throw new UsageError(`unknown command ${command}`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    return await run(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${PROG}: ${error.message}`);
      console.error(USAGE);
      return 2;
    }
    if (error instanceof IoError) {
      console.error(`${PROG}: ${error.message}`);
      return 3;
    }
    console.error(`${PROG}: ${errorMessage(error)}`);
    return 1;
  }
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
