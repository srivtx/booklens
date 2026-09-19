/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "../src/audit";
import { toSarif, writeSarif } from "../src/sarif";
import type { AuditResult } from "../src/types";
import { makeInaccessibleEpub } from "../scripts/make-fixtures";

describe("toSarif", () => {
  it("maps audit results to a SARIF 2.1.0 log", () => {
    const result = audit(makeInaccessibleEpub(), "broken.epub");
    const log = toSarif(result, "booklens", "0.1.0");

    expect(log.version).toBe("2.1.0");
    expect(log.runs[0]?.tool.driver.name).toBe("booklens");
    expect(log.runs[0]?.tool.driver.version).toBe("0.1.0");

    const e001 = log.runs[0]?.results.find((entry) => entry.ruleId === "E001");
    expect(e001?.level).toBe("error");
    expect(e001?.locations[0]?.physicalLocation.region.startLine).toBe(1);
    expect(e001?.properties.tags).toContain("accessibility");
    expect(e001?.properties.tags).toContain("wcag-3.1.1");

    const rule = log.runs[0]?.tool.driver.rules.find(
      (entry) => entry.id === "E001",
    );
    expect(rule?.helpUri).toBe("https://github.com/srivtx/booklens#rules");
    expect(rule?.shortDescription.text.length).toBeGreaterThan(0);
  });

  it("maps an info-severity issue to note", () => {
    const result = audit(makeInaccessibleEpub(), "broken.epub");
    const info = result.issues.find((issue) => issue.severity === "info");
    expect(info).toBeDefined();

    const log = toSarif(result, "booklens", "0.1.0");
    const mapped = log.runs[0]?.results.find(
      (entry) => entry.ruleId === info?.code && entry.level === "note",
    );

    expect(mapped?.level).toBe("note");
    expect(mapped?.properties.tags).toContain("wcag-1.3.1");
  });

  it("accepts an array of results", () => {
    const log = toSarif(
      [
        audit(makeInaccessibleEpub(), "a.epub"),
        audit(makeInaccessibleEpub(), "b.epub"),
      ],
      "booklens",
      "0.1.0",
    );

    expect(log.runs[0]?.results.length).toBeGreaterThan(0);
    expect(log.runs[0]?.tool.driver.rules.length).toBeGreaterThan(0);
  });
});

describe("writeSarif", () => {
  it("writes valid JSON that reads back", async () => {
    const result: AuditResult = audit(makeInaccessibleEpub(), "broken.epub");
    const path = join(tmpdir(), `booklens-${Date.now()}.sarif`);

    await writeSarif(path, result, "booklens", "0.1.0");

    const text = await Bun.file(path).text();
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs[0].tool.driver.name).toBe("booklens");
  });
});
