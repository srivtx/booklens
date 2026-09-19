/// <reference types="bun" />
import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli";
import pkg from "../package.json" with { type: "json" };
import { makeInaccessibleEpub } from "../scripts/make-fixtures";

const dir = mkdtempSync(join(tmpdir(), "booklens-cli-"));
const badPath = join(dir, "notepub.txt");
writeFileSync(badPath, "definitely not an epub");
const bookPath = join(dir, "book.epub");
writeFileSync(bookPath, makeInaccessibleEpub());

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

describe("cli exit codes", () => {
  it("exits 2 and explains when audit input is not an EPUB", async () => {
    const c = capture();
    try {
      const code = await main(["audit", badPath]);
      expect(code).toBe(2);
      expect(c.errs.join("\n")).toContain("Cannot parse");
    } finally {
      c.restore();
    }
  });

  it("exits 2 and explains when fix input is not an EPUB", async () => {
    const c = capture();
    try {
      const code = await main(["fix", badPath]);
      expect(code).toBe(2);
      expect(c.errs.join("\n")).toContain("Cannot parse");
    } finally {
      c.restore();
    }
  });

  it("exits 2 when the input file does not exist", async () => {
    const c = capture();
    try {
      const code = await main(["audit", join(dir, "missing.epub")]);
      expect(code).toBe(2);
      expect(c.errs.join("\n")).toContain("Cannot read");
    } finally {
      c.restore();
    }
  });

  it("exits 1 when findings meet the fail-on threshold", async () => {
    const c = capture();
    try {
      expect(await main(["audit", bookPath])).toBe(1);
    } finally {
      c.restore();
    }
  });
});

describe("cli argument handling", () => {
  it("supports -v and --version", async () => {
    const c = capture();
    try {
      expect(await main(["-v"])).toBe(0);
      expect(await main(["audit", "-v"])).toBe(0);
      expect(await main(["fix", "--version"])).toBe(0);
      expect(c.out.filter((line) => line === pkg.version).length).toBe(3);
    } finally {
      c.restore();
    }
  });

  it("rejects multiple positional files", async () => {
    const c = capture();
    try {
      const code = await main(["audit", bookPath, "extra.epub"]);
      expect(code).toBe(1);
      expect(c.errs.join("\n")).toContain("Unexpected extra argument");
    } finally {
      c.restore();
    }
  });

  it("rejects an unknown --only code", async () => {
    const c = capture();
    try {
      const code = await main([
        "fix",
        bookPath,
        "--only",
        "E001,BOGUS",
        "--dry-run",
      ]);
      expect(code).toBe(1);
      expect(c.errs.join("\n")).toContain("Unknown rule code");
    } finally {
      c.restore();
    }
  });

  it("does not silently drop a second space-separated --only code", async () => {
    const c = capture();
    try {
      const code = await main([
        "fix",
        bookPath,
        "--only",
        "E001",
        "E002",
        "--dry-run",
      ]);
      expect(code).toBe(1);
      expect(c.errs.join("\n")).toContain("Unexpected extra argument");
    } finally {
      c.restore();
    }
  });

  it("accepts a comma-separated --only list", async () => {
    const c = capture();
    try {
      const code = await main([
        "fix",
        bookPath,
        "--only",
        "E001,E002",
        "--dry-run",
      ]);
      expect(code).toBe(1);
      expect(c.errs.join("\n")).not.toContain("Unknown rule code");
      expect(c.errs.join("\n")).not.toContain("--only");
    } finally {
      c.restore();
    }
  });

  it("rejects --sarif without a path", async () => {
    const c = capture();
    try {
      const code = await main(["audit", bookPath, "--sarif", "--json"]);
      expect(code).toBe(1);
      expect(c.errs.join("\n")).toContain("--sarif requires");
    } finally {
      c.restore();
    }
  });
});
