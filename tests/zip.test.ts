import { describe, expect, it } from "bun:test";
import { buildEpub, readEpub, writeEpub } from "../src/zip";
import type { EpubStore } from "../src/types";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

function makeStore(entries: [string, string][]): EpubStore {
  const files = entries.map(([path, text]) => ({
    path,
    data: encoder.encode(text),
  }));
  const index = new Map(files.map((file) => [file.path, file.data]));
  return {
    files,
    list: () => files.map((file) => file.path).sort(),
    get: (path: string) => index.get(path),
  };
}

function u16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function firstEntryName(data: Uint8Array): string {
  const nameLength = u16(data, 26);
  return decoder.decode(data.subarray(30, 30 + nameLength));
}

describe("writeEpub / readEpub", () => {
  it("round-trips file contents and ordering", () => {
    const store = makeStore([
      ["mimetype", "application/epub+zip"],
      ["META-INF/container.xml", "<container/>"],
      ["OEBPS/content.opf", "<package/>"],
      ["OEBPS/chapter1.xhtml", "<html>one</html>"],
    ]);

    const epub = writeEpub(store);
    const restored = readEpub(epub);

    expect(restored.list()).toEqual([
      "META-INF/container.xml",
      "OEBPS/chapter1.xhtml",
      "OEBPS/content.opf",
      "mimetype",
    ]);

    for (const file of store.files) {
      const bytes = restored.get(file.path);
      expect(bytes).toBeDefined();
      expect(decoder.decode(bytes)).toBe(decoder.decode(file.data));
    }
  });

  it("places mimetype first and stores it uncompressed", () => {
    const store = makeStore([
      ["META-INF/container.xml", "<container/>"],
      ["mimetype", "application/epub+zip"],
      ["OEBPS/content.opf", "<package/>"],
    ]);

    const epub = writeEpub(store);

    expect(u16(epub, 0)).toBe(0x4b50);
    expect(firstEntryName(epub)).toBe("mimetype");
    expect(u16(epub, 8)).toBe(0);
  });

  it("supports get and list on a read store", () => {
    const store = readEpub(
      buildEpub([{ path: "OEBPS/a.xhtml", data: "<html/>" }]),
    );

    expect(store.list()).toEqual(["OEBPS/a.xhtml", "mimetype"]);
    expect(decoder.decode(store.get("OEBPS/a.xhtml"))).toBe("<html/>");
    expect(store.get("does/not/exist")).toBeUndefined();
  });
});

describe("buildEpub", () => {
  it("produces a readable epub with the correct mimetype content", () => {
    const epub = buildEpub([
      { path: "META-INF/container.xml", data: "<container/>" },
      { path: "OEBPS/content.opf", data: "<package/>" },
    ]);

    const store = readEpub(epub);
    const mimetype = store.get("mimetype");

    expect(mimetype).toBeDefined();
    expect(decoder.decode(mimetype)).toBe("application/epub+zip");
    expect(decoder.decode(store.get("META-INF/container.xml"))).toBe("<container/>");
  });
});
