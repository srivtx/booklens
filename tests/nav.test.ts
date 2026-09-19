/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { audit } from "../src/audit";
import { findNavDoc } from "../src/nav";
import { parseOpf } from "../src/opf";
import { readEpub } from "../src/zip";
import {
  makeInaccessibleEpub,
  makeNcxEpub,
  makeSingleQuoteNavEpub,
} from "../scripts/make-fixtures";

describe("findNavDoc", () => {
  test("detects single-quoted epub:type attributes", () => {
    const store = readEpub(makeSingleQuoteNavEpub());
    const opf = parseOpf(store);
    expect(opf).toBeDefined();

    const nav = findNavDoc(store, opf!);
    expect(nav).toBeDefined();
    expect(nav?.isXhtml).toBe(true);
    expect(nav?.hasToc).toBe(true);
    expect(nav?.hasLandmarks).toBe(true);
    expect(nav?.hasPageList).toBe(false);
  });

  test("marks an NCX fallback as non-XHTML", () => {
    const store = readEpub(makeNcxEpub());
    const opf = parseOpf(store);
    expect(opf).toBeDefined();

    const nav = findNavDoc(store, opf!);
    expect(nav).toBeDefined();
    expect(nav?.isXhtml).toBe(false);
  });
});

describe("rule metadata", () => {
  test("W011 is conditional and W014 is not fixable", () => {
    const withPagebreaks = audit(makeSingleQuoteNavEpub());
    const warning = withPagebreaks.issues.find((issue) => issue.code === "W011");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    expect(warning?.fixable).toBe(true);

    const withoutPagebreaks = audit(makeInaccessibleEpub());
    const info = withoutPagebreaks.issues.find((issue) => issue.code === "W011");
    expect(info).toBeDefined();
    expect(info?.severity).toBe("info");
    expect(info?.fixable).toBe(false);

    for (const issue of withoutPagebreaks.issues.filter(
      (entry) => entry.code === "W014",
    )) {
      expect(issue.fixable).toBe(false);
    }
  });

  test("W010 on an NCX navigation document is not fixable", () => {
    const result = audit(makeNcxEpub());
    const w010 = result.issues.find((issue) => issue.code === "W010");
    expect(w010).toBeDefined();
    expect(w010?.fixable).toBe(false);
  });
});
