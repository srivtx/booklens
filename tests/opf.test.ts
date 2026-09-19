/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { resolveHref } from "../src/opf";

describe("resolveHref", () => {
  test("strips query strings and fragments", () => {
    expect(resolveHref("OEBPS", "chapter1.xhtml#page1")).toBe(
      "OEBPS/chapter1.xhtml",
    );
    expect(resolveHref("OEBPS", "chapter1.xhtml?x=1")).toBe(
      "OEBPS/chapter1.xhtml",
    );
    expect(resolveHref("OEBPS", "a/b.xhtml#c?d=1")).toBe("OEBPS/a/b.xhtml");
    expect(resolveHref("", "chapter1.xhtml#page1")).toBe("chapter1.xhtml");
    expect(resolveHref("OEBPS/text", "../images/pic.png?x#y")).toBe(
      "OEBPS/images/pic.png",
    );
  });
});
