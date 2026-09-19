import {
  strToU8,
  unzipSync,
  zipSync,
  type UnzipFileInfo,
  type ZipOptions,
} from "fflate";
import type { EpubFile, EpubStore } from "./types";
import { EpubReadError } from "./errors";

const MIMETYPE_PATH = "mimetype";
const MIMETYPE_VALUE = "application/epub+zip";

// A fixed DOS timestamp so that two fixes of the same book produce identical
// bytes. `new Date(...)` with local components keeps the encoded fields stable
// across time zones because fflate reads them back with local getters.
const FIXED_MTIME = new Date(2000, 0, 1, 0, 0, 0);

/**
 * Hard caps applied while reading an untrusted ZIP. They are checked against
 * the sizes declared in the central directory *before* any member is
 * allocated, so a small archive that declares a huge member fails fast instead
 * of exhausting memory.
 */
export interface UnzipLimits {
  maxMembers: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_UNZIP_LIMITS: UnzipLimits = {
  maxMembers: 65535,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
};

function isDirectoryEntry(name: string): boolean {
  return name.endsWith("/");
}

/**
 * Canonical member path: Unicode NFC, forward slashes, no leading `./`, no
 * absolute paths, and no `..` or empty segments. Throws for anything that
 * cannot be a safe relative member path.
 */
export function normalizeMemberPath(raw: string): string {
  let path = raw.normalize("NFC").replace(/\\/g, "/");
  while (path.startsWith("./")) path = path.slice(2);

  if (path === "") {
    throw new EpubReadError(`empty member path: ${JSON.stringify(raw)}`);
  }
  if (path.startsWith("/") || /^[A-Za-z]:\//.test(path)) {
    throw new EpubReadError(`absolute member path: ${JSON.stringify(raw)}`);
  }

  for (const segment of path.split("/")) {
    if (segment === "") {
      throw new EpubReadError(
        `empty path segment in member path: ${JSON.stringify(raw)}`,
      );
    }
    if (segment === "." || segment === "..") {
      throw new EpubReadError(
        `unsafe path segment in member path: ${JSON.stringify(raw)}`,
      );
    }
  }

  return path;
}

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

export function readEpub(
  data: Uint8Array,
  limits: UnzipLimits = DEFAULT_UNZIP_LIMITS,
): EpubStore {
  let unzipped: Record<string, Uint8Array>;
  let memberCount = 0;
  let declaredTotal = 0;
  try {
    unzipped = unzipSync(data, {
      filter: (file: UnzipFileInfo): boolean => {
        if (isDirectoryEntry(file.name)) return false;
        memberCount += 1;
        if (memberCount > limits.maxMembers) {
          throw new EpubReadError(
            `archive has more than ${limits.maxMembers} members`,
          );
        }
        if (file.originalSize > limits.maxEntryBytes) {
          throw new EpubReadError(
            `archive member ${JSON.stringify(file.name)} expands beyond ${limits.maxEntryBytes} bytes`,
          );
        }
        declaredTotal += file.originalSize;
        if (declaredTotal > limits.maxTotalBytes) {
          throw new EpubReadError(
            `archive expands beyond ${limits.maxTotalBytes} bytes`,
          );
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof EpubReadError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new EpubReadError(`not a readable EPUB/ZIP archive: ${detail}`);
  }

  let actualTotal = 0;
  for (const bytes of Object.values(unzipped)) actualTotal += bytes.length;
  if (actualTotal > limits.maxTotalBytes) {
    throw new EpubReadError(
      `archive expands beyond ${limits.maxTotalBytes} bytes`,
    );
  }

  const files: EpubFile[] = [];
  const seen = new Set<string>();
  for (const rawPath of Object.keys(unzipped)) {
    const bytes = unzipped[rawPath];
    if (!bytes) continue;
    const path = normalizeMemberPath(rawPath);
    if (seen.has(path)) {
      throw new EpubReadError(`duplicate member path: ${path}`);
    }
    seen.add(path);
    files.push({ path, data: bytes });
  }

  return makeStore(files);
}

export function writeEpub(store: EpubStore): Uint8Array {
  const safeFiles = store.files.map((file) => ({
    path: normalizeMemberPath(file.path),
    data: file.data,
  }));

  const zippable: Record<string, [Uint8Array, ZipOptions]> = {};
  const mimetype = safeFiles.find((file) => file.path === MIMETYPE_PATH);
  zippable[MIMETYPE_PATH] = [
    mimetype ? mimetype.data : strToU8(MIMETYPE_VALUE),
    { level: 0, mtime: FIXED_MTIME },
  ];

  for (const file of safeFiles) {
    if (file.path === MIMETYPE_PATH) continue;
    zippable[file.path] = [file.data, { level: 6, mtime: FIXED_MTIME }];
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
