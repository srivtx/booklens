/// <reference types="bun" />
import { afterAll, describe, expect, it, spyOn } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli";
import { buildEpub } from "../src/zip";
import pkg from "../package.json" with { type: "json" };
import { makeInaccessibleEpub } from "../scripts/make-fixtures";

const dir = mkdtempSync(join(tmpdir(), "booklens-cli-"));
const badPath = join(dir, "notepub.txt");
writeFileSync(badPath, "definitely not an epub");
const bookPath = join(dir, "book.epub");
writeFileSync(bookPath, makeInaccessibleEpub());

// A structurally valid ZIP that is not an EPUB (no container.xml / OPF).
const notEpubZipPath = join(dir, "not-an-epub.zip");
writeFileSync(
  notEpubZipPath,
  buildEpub([{ path: "README.txt", data: "just a zip" }]),
);

// Two books in a directory, for --dir.
const booksDir = join(dir, "books");
mkdirSync(booksDir);
copyFileSync(bookPath, join(booksDir, "one.epub"));
copyFileSync(bookPath, join(booksDir, "two.epub"));
writeFileSync(join(booksDir, "ignore.txt"), "not a book");

const blocker = join(dir, "blocker");
writeFileSync(blocker, "not a directory");
const missingOutput = join(blocker, "out.epub");

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Capture {
  out: string[];
  errs: string[];
  restore: () => void;
}

function capture(): Capture {
  const out: string[] = [];
  const errs: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.join(" "));
  });
  const error = spyOn(console, "error").mockImplementation(
    (...args: unknown[]) => {
      errs.push(args.join(" "));
    },
  );
  return {
    out,
    errs,
    restore: () => {
      log.mockRestore();
      error.mockRestore();
    },
  };
}

async function run(args: string[]): Promise<{
  code: number;
  out: string;
  errs: string;
}> {
  const c = capture();
  try {
    const code = await main(args);
    return { code, out: c.out.join("\n"), errs: c.errs.join("\n") };
  } finally {
    c.restore();
  }
}

describe("cli exit codes", () => {
  it("exits 2 and explains when audit input is not an EPUB", async () => {
    const { code, errs } = await run(["audit", badPath]);
    expect(code).toBe(2);
    expect(errs).toContain("booklens: cannot parse");
  });

  it("exits 2 and explains when fix input is not an EPUB", async () => {
    const { code, errs } = await run(["fix", badPath]);
    expect(code).toBe(2);
    expect(errs).toContain("booklens: cannot parse");
  });

  it("exits 2 when audit input is a valid ZIP that is not an EPUB", async () => {
    const { code, errs } = await run(["audit", notEpubZipPath]);
    expect(code).toBe(2);
    expect(errs).toContain("booklens: cannot parse");
    expect(errs).toContain("not a readable EPUB");
  });

  it("exits 2 when fix input is a valid ZIP that is not an EPUB", async () => {
    const { code, errs } = await run(["fix", notEpubZipPath, "--dry-run"]);
    expect(code).toBe(2);
    expect(errs).toContain("booklens: cannot parse");
    expect(errs).toContain("not a readable EPUB");
  });

  it("exits 3 when the input file does not exist", async () => {
    const { code, errs } = await run(["audit", join(dir, "missing.epub")]);
    expect(code).toBe(3);
    expect(errs).toContain("booklens: cannot read");
  });

  it("exits 3 when --dir cannot be read", async () => {
    const { code, errs } = await run([
      "audit",
      "--dir",
      join(dir, "missing-dir"),
    ]);
    expect(code).toBe(3);
    expect(errs).toContain("booklens: cannot read directory");
  });

  it("exits 3 when an output file cannot be written", async () => {
    const { code, errs } = await run([
      "fix",
      bookPath,
      "-o",
      missingOutput,
    ]);
    expect(code).toBe(3);
    expect(errs).toContain("booklens: cannot write");
  });

  it("exits 3 when a SARIF report cannot be written", async () => {
    const { code, errs } = await run([
      "audit",
      bookPath,
      "--sarif",
      missingOutput,
    ]);
    expect(code).toBe(3);
    expect(errs).toContain("booklens: cannot write");
  });

  it("exits 2 on usage errors (no command, no input, extra positional)", async () => {
    expect((await run([])).code).toBe(2);
    expect((await run(["audit"])).code).toBe(2);
    const extra = await run(["audit", bookPath, "extra.epub"]);
    expect(extra.code).toBe(2);
    expect(extra.errs).toContain("booklens: unexpected extra argument");
  });

  it("exits 1 when findings meet the fail-on threshold", async () => {
    expect((await run(["audit", bookPath])).code).toBe(1);
  });

  it("exits 0 when findings are below the fail-on threshold", async () => {
    expect((await run(["audit", bookPath, "--fail-on", "none"])).code).toBe(0);
  });
});

describe("cli option strictness", () => {
  it("rejects an unknown long option with a prefixed error and usage", async () => {
    const { code, errs, out } = await run(["audit", bookPath, "--bogus"]);
    expect(code).toBe(2);
    expect(errs).toContain("booklens: unknown option --bogus");
    expect(errs).toContain("Usage:");
    expect(out).toBe("");
  });

  it("rejects an unknown short option", async () => {
    const { code, errs } = await run(["audit", bookPath, "-x"]);
    expect(code).toBe(2);
    expect(errs).toContain("booklens: unknown option -x");
  });

  it("does not let a boolean flag consume the next token", async () => {
    const { code, out } = await run(["audit", "--json", bookPath]);
    expect(code).toBe(1);
    const parsed = JSON.parse(out) as { file: string };
    expect(parsed.file).toBe(bookPath);
  });

  it("rejects a value passed to a boolean flag", async () => {
    const { code, errs } = await run(["audit", bookPath, "--json=true"]);
    expect(code).toBe(2);
    expect(errs).toContain("does not take a value");
  });

  it("supports -- to end option parsing", async () => {
    const { code, errs } = await run(["audit", "--", "--json"]);
    expect(code).toBe(3);
    expect(errs).toContain("cannot read --json");
  });

  it("supports --flag=value for value flags", async () => {
    const fixed = await run([
      "fix",
      bookPath,
      "--only=E001",
      "--language=en",
      "--title=Equals",
      "--dry-run",
    ]);
    expect(fixed.code).toBe(1);
    expect(fixed.errs).not.toContain("unknown option");
    expect(fixed.out).toContain("E001:");
  });

  it("errors (exit 2) when a value flag is missing its value", async () => {
    for (const flag of ["--fail-on", "--sarif", "--language", "--title", "--only"]) {
      const { code, errs } = await run(["audit", bookPath, flag]);
      expect(`${flag} -> ${code}: ${errs}`).toContain(
        `booklens: option ${flag} requires a value`,
      );
      expect(code).toBe(2);
    }
  });

  it("errors (exit 2) on an invalid --fail-on value", async () => {
    const { code, errs } = await run(["audit", bookPath, "--fail-on", "loud"]);
    expect(code).toBe(2);
    expect(errs).toContain("booklens: invalid --fail-on value");
  });

  it("errors (exit 2) on an unknown --only code", async () => {
    const { code, errs } = await run([
      "fix",
      bookPath,
      "--only",
      "E001,BOGUS",
      "--dry-run",
    ]);
    expect(code).toBe(2);
    expect(errs).toContain("unknown rule code");
  });

  it("does not silently drop a second space-separated --only code", async () => {
    const { code, errs } = await run([
      "fix",
      bookPath,
      "--only",
      "E001",
      "E002",
      "--dry-run",
    ]);
    expect(code).toBe(2);
    expect(errs).toContain("unexpected extra argument");
  });

  it("accepts a comma-separated --only list", async () => {
    const { code, errs } = await run([
      "fix",
      bookPath,
      "--only",
      "E001,E002",
      "--dry-run",
    ]);
    expect(code).toBe(1);
    expect(errs).not.toContain("unknown rule code");
  });
});

describe("cli output modes", () => {
  it("prints the version for every tool", async () => {
    expect(await run(["-v"])).toMatchObject({ code: 0 });
    expect((await run(["--version"])).out).toBe(pkg.version);
    expect((await run(["audit", "-v"])).out).toBe(pkg.version);
    expect((await run(["audit", "--version"])).out).toBe(pkg.version);
    expect((await run(["fix", "-v"])).out).toBe(pkg.version);
  });

  it("prints one summary line per file with --quiet and -q", async () => {
    const long = await run(["audit", bookPath, "--quiet"]);
    expect(long.code).toBe(1);
    expect(long.out.split("\n")).toHaveLength(1);
    expect(long.out).toContain("error(s)");

    const short = await run(["audit", bookPath, "-q"]);
    expect(short.out).toBe(long.out);
  });

  it("prints a single JSON object for one input", async () => {
    const { out, code } = await run(["audit", bookPath, "--json"]);
    expect(code).toBe(1);
    const parsed = JSON.parse(out) as { file: string; issues: unknown[] };
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.file).toBe(bookPath);
    expect(Array.isArray(parsed.issues)).toBe(true);
  });

  it("prints a JSON array when --dir reads multiple files", async () => {
    const { out, code } = await run(["audit", "--dir", booksDir, "--json"]);
    expect(code).toBe(1);
    const parsed = JSON.parse(out) as { file: string }[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it("combines --dir with explicit positional inputs", async () => {
    const { out } = await run([
      "audit",
      "--dir",
      booksDir,
      badPath,
    ]);
    // badPath is a positional, but it is not read before --dir files.
    expect(out).toContain("error");
  });

  it("prints a JSON object for fix and records skipped actions", async () => {
    const { out, code } = await run([
      "fix",
      bookPath,
      "--dry-run",
      "--json",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as {
      file: string;
      applied: string[];
      skipped: string[];
      dryRun: boolean;
    };
    expect(parsed.file).toBe(bookPath);
    expect(Array.isArray(parsed.applied)).toBe(true);
    expect(Array.isArray(parsed.skipped)).toBe(true);
    expect(parsed.dryRun).toBe(true);
  });
});
