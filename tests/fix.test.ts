/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { XMLValidator } from "fast-xml-parser";
import { audit } from "../src/audit";
import { fixEpub } from "../src/fix";
import { readEpub } from "../src/zip";
import { resolveHref } from "../src/opf";
import { EpubReadError } from "../src/errors";
import {
  makeInaccessibleEpub,
  makeNcxEpub,
  makeNoNavEpub,
} from "../scripts/make-fixtures";

const decoder = new TextDecoder("utf-8");

function u16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function firstEntryName(data: Uint8Array): string {
  const nameLength = u16(data, 26);
  return decoder.decode(data.subarray(30, 30 + nameLength));
}

describe("fixEpub", () => {
  it("fixes an inaccessible publication and clears all errors", () => {
    const result = fixEpub(makeInaccessibleEpub());
    const after = audit(result.data);

    expect(after.counts.error).toBe(0);

    for (const code of [
      "E001",
      "E002",
      "E003",
      "E004",
      "E005",
      "E006",
      "E008",
      "E009",
    ]) {
      expect(result.applied.some((entry) => entry.startsWith(`${code}:`))).toBe(
        true,
      );
    }
  });

  it("writes a readable epub with mimetype as the first entry", () => {
    const result = fixEpub(makeInaccessibleEpub());

    expect(u16(result.data, 0)).toBe(0x4b50);
    expect(firstEntryName(result.data)).toBe("mimetype");

    const store = readEpub(result.data);
    expect(decoder.decode(store.get("mimetype"))).toBe("application/epub+zip");
  });

  it("respects the only option", () => {
    const result = fixEpub(makeInaccessibleEpub(), { only: ["E001"] });

    expect(result.applied.some((entry) => entry.startsWith("E001:"))).toBe(true);
    expect(result.applied.some((entry) => entry.startsWith("E002:"))).toBe(false);
  });

  it("throws EpubReadError instead of returning a zero-count result on unreadable input", () => {
    const garbage = new TextEncoder().encode("this is not an epub at all");

    expect(() => audit(garbage, "notepub.txt")).toThrow(EpubReadError);
    expect(() => fixEpub(garbage)).toThrow(EpubReadError);
  });

  it("writes a generated navigation document and registers it (E015 round trip)", () => {
    const result = fixEpub(makeNoNavEpub());
    expect(result.applied.some((entry) => entry.startsWith("E015:"))).toBe(true);

    const after = audit(result.data);
    expect(after.issues.map((issue) => issue.code)).not.toContain("E015");

    const store = readEpub(result.data);
    const opfRaw = decoder.decode(store.get("OEBPS/content.opf"));
    expect(opfRaw).toContain('properties="nav"');
    const href = /href="([^"]*nav\.xhtml)"/.exec(opfRaw)?.[1];
    expect(href).toBeDefined();
    const target = resolveHref("OEBPS", href ?? "");
    expect(store.get(target)).toBeDefined();
  });

  it("does not corrupt an NCX-only EPUB with XHTML nav markup", () => {
    const result = fixEpub(makeNcxEpub(), { language: "en", title: "NCX Book" });

    const store = readEpub(result.data);
    for (const path of store.list()) {
      if (!/\.(xhtml|ncx|opf|xml)$/i.test(path)) continue;
      const check = XMLValidator.validate(decoder.decode(store.get(path)), {
        allowBooleanAttributes: true,
      });
      expect({ path, check }).toEqual({ path, check: true });
    }

    const ncx = decoder.decode(store.get("OEBPS/toc.ncx"));
    expect(ncx).not.toContain("landmarks");
    expect(ncx).not.toContain("page-list");

    expect(
      result.applied.some(
        (entry) => entry.startsWith("W010:") && entry.includes("skipped"),
      ) ||
        result.applied.some(
          (entry) => entry.startsWith("W011:") && entry.includes("skipped"),
        ),
    ).toBe(true);
  });

  it("writes an explicit alt placeholder and logs every changed image", () => {
    const result = fixEpub(makeInaccessibleEpub());

    const store = readEpub(result.data);
    const chapter = decoder.decode(store.get("OEBPS/chapter1.xhtml"));
    expect(chapter).toContain('alt="TODO: describe image"');
    expect(chapter).not.toContain('alt=""');

    const entries = result.applied.filter((entry) => entry.startsWith("E008:"));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toContain("TODO: describe image");
      expect(entry).toContain("img src=");
    }
  });
});
