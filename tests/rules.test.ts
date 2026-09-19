/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { audit } from "../src/audit";
import { makeInaccessibleEpub, makeGoodEpub } from "../scripts/make-fixtures";
import { buildEpub } from "../src/zip";

describe("audit", () => {
  test("reports the expected issues for an inaccessible publication", () => {
    const result = audit(makeInaccessibleEpub());
    const codes = result.issues.map((issue: { code: string }) => issue.code);

    for (const code of [
      "E001",
      "E002",
      "E003",
      "E004",
      "E005",
      "E006",
      "W007",
      "E008",
      "E009",
      "W010",
      "W012",
      "W013",
      "W014",
    ]) {
      expect(codes).toContain(code);
    }

    expect(result.counts.error).toBeGreaterThan(0);
  });

  test("reports no errors for a good publication", () => {
    const result = audit(makeGoodEpub());
    const codes = result.issues.map((issue: { code: string }) => issue.code);

    expect(result.counts.error).toBe(0);
    for (const code of ["E001", "E002", "E008", "E009"]) {
      expect(codes).not.toContain(code);
    }
  });

  test("does not throw on a store with only a mimetype", () => {
    const data = buildEpub([]);
    expect(() => audit(data)).not.toThrow();

    const result = audit(data);
    const codes = result.issues.map((issue: { code: string }) => issue.code);
    expect(codes).toContain("E015");
  });
});
