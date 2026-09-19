/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { audit } from "../src/audit";
import { fixEpub } from "../src/fix";
import { readEpub } from "../src/zip";
import { makeInaccessibleEpub } from "../scripts/make-fixtures";

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
});
