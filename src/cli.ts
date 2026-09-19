import { audit } from "./audit";
import { fixEpub } from "./fix";

const USAGE = `Usage:
  audit <file> [--json]
  fix <file> -o <out> [--language <lang>] [--title <title>] [--only CODES] [--dry-run]`;

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

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

async function runAudit(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
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

  return result.counts.error > 0 ? 1 : 0;
}

async function runFix(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
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

  return 0;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);

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
