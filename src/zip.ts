import { strToU8, unzipSync, zipSync, type ZipOptions } from "fflate";
import type { EpubFile, EpubStore } from "./types";

const MIMETYPE_PATH = "mimetype";
const MIMETYPE_VALUE = "application/epub+zip";

function makeStore(files: EpubFile[]): EpubStore {
  const index = new Map<string, Uint8Array>();
  for (const file of files) index.set(file.path, file.data);

  return {
    files,
    list(): string[] {
      return files.map((file) => file.path).sort();
    },
    get(path: string): Uint8Array | undefined {
      return index.get(path);
    },
  };
}

export function readEpub(data: Uint8Array): EpubStore {
  const unzipped = unzipSync(data);
  const files: EpubFile[] = [];

  for (const path of Object.keys(unzipped)) {
    const bytes = unzipped[path];
    if (!bytes) continue;
    files.push({ path, data: bytes });
  }

  return makeStore(files);
}

export function writeEpub(store: EpubStore): Uint8Array {
  const zippable: Record<string, [Uint8Array, ZipOptions]> = {};

  const mimetype = store.files.find((file) => file.path === MIMETYPE_PATH);
  zippable[MIMETYPE_PATH] = [
    mimetype ? mimetype.data : strToU8(MIMETYPE_VALUE),
    { level: 0 },
  ];

  for (const file of store.files) {
    if (file.path === MIMETYPE_PATH) continue;
    zippable[file.path] = [file.data, { level: 6 }];
  }

  return zipSync(zippable);
}

export function buildEpub(
  files: { path: string; data: string | Uint8Array }[],
): Uint8Array {
  const entries: EpubFile[] = files
    .filter((file) => file.path !== MIMETYPE_PATH)
    .map((file) => ({
      path: file.path,
      data: typeof file.data === "string" ? strToU8(file.data) : file.data,
    }));

  entries.unshift({ path: MIMETYPE_PATH, data: strToU8(MIMETYPE_VALUE) });

  return writeEpub(makeStore(entries));
}
