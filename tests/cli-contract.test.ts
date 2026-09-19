/// <reference types="bun" />
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeGoodEpub, makeInaccessibleEpub } from "../scripts/make-fixtures";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "src", "cli.ts");
const TOOL = "booklens";
const VERSION = (
  JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }
).version;

const workDir = mkdtempSync(join(tmpdir(), "booklens-contract-"));
const goodPath = join(workDir, "good.epub");
const badPath = join(workDir, "bad.epub");
writeFileSync(goodPath, makeGoodEpub());
writeFileSync(badPath, makeInaccessibleEpub());
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliResult {
  const proc = Bun.spawnSync(["bun", "run", CLI, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("booklens CLI contract", () => {
  test("--version and -v print exactly the package version", () => {
    for (const flag of ["--version", "-v"]) {
      const res = runCli([flag]);
      expect(res.code).toBe(0);
      expect(res.stdout.trim()).toBe(VERSION);
    }
  });

  test("--help and -h exit 0 and document the exit codes", () => {
    for (const flag of ["--help", "-h"]) {
      const res = runCli([flag]);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("Exit codes:");
      for (const code of ["0", "1", "2", "3"]) {
        expect(res.stdout).toMatch(new RegExp(`^\\s*${code}\\s`, "m"));
      }
    }
  });

  test("an unknown option exits 2 with the shared message", () => {
    const res = runCli(["audit", "--bogus"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain(`${TOOL}: unknown option --bogus`);
  });

  test("-- ends option parsing so a dash-prefixed path is a file", () => {
    const res = runCli(["audit", "--", "--not-an-option"]);
    expect(res.code).toBe(3);
    expect(res.stderr).toContain("--not-an-option");
    expect(res.stderr).not.toContain("unknown option");
  });

  test("--flag=value works and a value flag without a value exits 2", () => {
    const inline = runCli(["audit", "--fail-on=none", badPath]);
    expect(inline.code).toBe(0);
    expect(inline.stderr).not.toContain("unknown option");

    const missing = runCli(["audit", goodPath, "--fail-on"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("--fail-on");
  });

  test("a missing input file exits 3 (I/O)", () => {
    const res = runCli(["audit", join(workDir, "missing.epub")]);
    expect(res.code).toBe(3);
    expect(res.stderr).toContain("cannot read");
  });

  test("no arguments exits 2", () => {
    expect(runCli([]).code).toBe(2);
  });

  test("a clean fixture exits 0 and a bad fixture exits 1", () => {
    expect(runCli(["audit", goodPath]).code).toBe(0);
    expect(runCli(["audit", badPath]).code).toBe(1);
  });
});
