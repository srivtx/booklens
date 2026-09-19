import { describe, expect, it } from "bun:test";
import { strToU8, zipSync } from "fflate";
import {
  DEFAULT_UNZIP_LIMITS,
  buildEpub,
  readEpub,
  writeEpub,
} from "../src/zip";
import { EpubReadError } from "../src/errors";
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

function u32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function writeU32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

function firstEntryName(data: Uint8Array): string {
  const nameLength = u16(data, 26);
  return decoder.decode(data.subarray(30, 30 + nameLength));
}

// Forge the uncompressed size a central-directory entry declares, without
// adding any data, to model a small zip bomb as seen by unzipSync's filter.
function forgeDeclaredUncompressedSize(
  zip: Uint8Array,
  name: string,
  size: number,
): Uint8Array {
  const out = zip.slice();
  let eocd = out.length - 22;
  while (eocd >= 0 && u32(out, eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("no end-of-central-directory record");

  let offset = u32(out, eocd + 16);
  while (offset + 46 <= out.length && u32(out, offset) === 0x02014b50) {
    const nameLength = u16(out, offset + 28);
    const extraLength = u16(out, offset + 30);
    const commentLength = u16(out, offset + 32);
    const entryName = decoder.decode(
      out.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (entryName === name) {
      writeU32(out, offset + 24, size);
      return out;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`member ${name} not found in central directory`);
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

  it("stamps a fixed mtime so output is byte-reproducible", () => {
    const store = makeStore([
      ["mimetype", "application/epub+zip"],
      ["OEBPS/content.opf", "<package/>"],
    ]);

    const first = writeEpub(store);
    const second = writeEpub(store);
    expect(Array.from(first)).toEqual(Array.from(second));

    // Local file header: mod time at 10, mod date at 12.
    const date = u16(first, 12);
    expect((date >> 9) + 1980).toBe(2000);
    expect((date >> 5) & 0xf).toBe(1);
    expect(date & 0x1f).toBe(1);
    expect(u16(first, 10)).toBe(0);
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

describe("readEpub limits", () => {
  it("rejects a zip declaring an oversized member before allocating it", () => {
    const epub = buildEpub([{ path: "OEBPS/big.xhtml", data: "<html/>" }]);
    const forged = forgeDeclaredUncompressedSize(
      epub,
      "OEBPS/big.xhtml",
      DEFAULT_UNZIP_LIMITS.maxEntryBytes + 1,
    );

    expect(() => readEpub(forged)).toThrow(EpubReadError);
    expect(() => readEpub(forged)).toThrow(/expands beyond/);
  });

  it("enforces maxMembers, maxEntryBytes, and maxTotalBytes", () => {
    const epub = buildEpub([
      { path: "OEBPS/a.xhtml", data: "a".repeat(50) },
      { path: "OEBPS/b.xhtml", data: "b".repeat(50) },
    ]);

    expect(() =>
      readEpub(epub, {
        maxMembers: 1,
        maxEntryBytes: 1000,
        maxTotalBytes: 1000,
      }),
    ).toThrow(/more than 1 members/);

    expect(() =>
      readEpub(epub, {
        maxMembers: 10,
        maxEntryBytes: 10,
        maxTotalBytes: 1000,
      }),
    ).toThrow(/expands beyond 10 bytes/);

    expect(() =>
      readEpub(epub, {
        maxMembers: 10,
        maxEntryBytes: 1000,
        maxTotalBytes: 60,
      }),
    ).toThrow(/expands beyond 60 bytes/);
  });

  it("accepts an archive whose members fit the limits", () => {
    const epub = buildEpub([{ path: "OEBPS/a.xhtml", data: "<html/>" }]);
    expect(readEpub(epub).get("OEBPS/a.xhtml")).toBeDefined();
  });
});

describe("readEpub / writeEpub path safety", () => {
  it("normalizes a leading ./ member name", () => {
    const zip = zipSync({
      "./OEBPS/a.xhtml": strToU8("<html/>"),
      mimetype: strToU8("application/epub+zip"),
    });

    const store = readEpub(zip);
    expect(store.get("OEBPS/a.xhtml")).toBeDefined();
    expect(store.get("./OEBPS/a.xhtml")).toBeUndefined();
  });

  it("rejects traversal member names on read", () => {
    const zip = zipSync({
      "../evil.xhtml": strToU8("<html/>"),
      mimetype: strToU8("application/epub+zip"),
    });

    expect(() => readEpub(zip)).toThrow(EpubReadError);
    expect(() => readEpub(zip)).toThrow(/unsafe path segment/);
  });

  it("rejects absolute member names on read", () => {
    const zip = zipSync({
      "/evil.xhtml": strToU8("<html/>"),
      mimetype: strToU8("application/epub+zip"),
    });

    expect(() => readEpub(zip)).toThrow(/absolute member path/);
  });

  it("never emits a member name that escapes the archive root", () => {
    const store = makeStore([
      ["mimetype", "application/epub+zip"],
      ["../evil.xhtml", "<html/>"],
    ]);

    expect(() => writeEpub(store)).toThrow(EpubReadError);
    expect(() => writeEpub(store)).toThrow(/unsafe path segment/);
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
