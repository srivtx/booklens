import { parseHTML } from "linkedom";
import type {
  EpubFile,
  EpubStore,
  FixOptions,
  FixResult,
  Issue,
  Opf,
} from "./types";
import { readEpub, writeEpub } from "./zip";
import { parseOpf, resolveHref } from "./opf";
import { findNavDoc } from "./nav";
import { audit } from "./audit";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

const ALT_PLACEHOLDER = "TODO: describe image";

interface DomElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  readonly textContent: string | null;
  readonly tagName?: string;
  querySelector?(selector: string): DomElement | null;
  querySelectorAll?(selector: string): ArrayLike<DomElement>;
}

interface DomDocument {
  readonly documentElement: DomElement | null;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  toString(): string;
}

function toBytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function toStr(value: Uint8Array | undefined): string {
  if (!value) return "";
  try {
    return decoder.decode(value);
  } catch {
    let out = "";
    for (let i = 0; i < value.length; i += 1) out += String.fromCharCode(value[i] ?? 0);
    return out;
  }
}

function parseDoc(html: string): DomDocument | undefined {
  try {
    const win = parseHTML(html) as unknown as { document?: DomDocument };
    return win ? win.document : undefined;
  } catch {
    return undefined;
  }
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "" : path.slice(0, slash);
}

function relativePath(fromDir: string, toPath: string): string {
  const from = fromDir.split("/").filter((part) => part.length > 0);
  const to = toPath.split("/").filter((part) => part.length > 0);
  let shared = 0;
  while (
    shared < from.length &&
    shared < to.length &&
    from[shared] === to[shared]
  ) {
    shared += 1;
  }
  const up = from.slice(shared).map(() => "..");
  const down = to.slice(shared);
  const parts = [...up, ...down];
  return parts.length > 0 ? parts.join("/") : basename(toPath);
}

function ensureMetadata(raw: string, snippet: string): string {
  if (/<\/metadata\s*>/i.test(raw)) {
    return raw.replace(/<\/metadata\s*>/i, () => `  ${snippet}\n  </metadata>`);
  }
  if (/<\/package\s*>/i.test(raw)) {
    return raw.replace(
      /<\/package\s*>/i,
      () =>
        `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n${snippet}\n  </metadata>\n</package>`,
    );
  }
  return `${raw}\n${snippet}`;
}

function setDcElement(raw: string, tag: string, value: string): string {
  const escaped = esc(value);
  const replacement = `<${tag}>${escaped}</${tag}>`;
  const paired = new RegExp(
    `<${tag}(\\s[^>]*)?>[\\s\\S]*?<\\/${tag}\\s*>`,
    "i",
  );
  if (paired.test(raw)) return raw.replace(paired, () => replacement);
  const selfClosing = new RegExp(`<${tag}(\\s[^>]*)?\\/\\s*>`, "i");
  if (selfClosing.test(raw)) return raw.replace(selfClosing, () => replacement);
  return ensureMetadata(raw, replacement);
}

function hasMetaProperty(raw: string, property: string): boolean {
  const re = new RegExp(
    `<meta[^>]*property\\s*=\\s*["']${escapeRegExp(property)}["']`,
    "i",
  );
  return re.test(raw);
}

function addMetaProperty(raw: string, property: string, value: string): string {
  const snippet = `<meta property="${esc(property)}">${esc(value)}</meta>`;
  return ensureMetadata(raw, snippet);
}

function spineDocPaths(opf: Opf): string[] {
  const byId = new Map(opf.manifest.map((item) => [item.id, item]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of opf.spine) {
    const item = byId.get(entry.idref);
    if (!item) continue;
    const mediaType = item.mediaType.toLowerCase();
    if (mediaType !== "application/xhtml+xml" && mediaType !== "text/html") {
      continue;
    }
    let path: string;
    try {
      path = resolveHref(opf.dir, item.href);
    } catch {
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function firstSpinePath(opf: Opf): string | undefined {
  return spineDocPaths(opf)[0];
}

function insertBeforeBodyClose(raw: string, snippet: string): string {
  const bodyMatch = /<\/body\s*>/i.exec(raw);
  if (bodyMatch && bodyMatch.index !== undefined) {
    const idx = bodyMatch.index;
    return `${raw.slice(0, idx)}${snippet}\n${raw.slice(idx)}`;
  }
  const lastNav = raw.toLowerCase().lastIndexOf("</nav>");
  if (lastNav !== -1) {
    return `${raw.slice(0, lastNav)}${snippet}\n${raw.slice(lastNav)}`;
  }
  return `${raw}\n${snippet}`;
}

function findNavId(raw: string, type: string): string | undefined {
  const re = new RegExp(
    `<nav\\b[^>]*epub:type\\s*=\\s*["'][^"']*\\b${escapeRegExp(type)}\\b[^"']*["'][^>]*>`,
    "i",
  );
  const match = re.exec(raw);
  if (!match || match[0] === undefined) return undefined;
  const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(match[0]);
  return idMatch ? idMatch[1] : undefined;
}

function labelsForPaths(paths: string[], files: Map<string, Uint8Array>): string[] {
  return paths.map((path) => {
    const bytes = files.get(path);
    if (!bytes) return basename(path);
    const doc = parseDoc(toStr(bytes));
    if (!doc) return basename(path);
    try {
      const title = doc.querySelector("title");
      const titleText = (title?.textContent ?? "").trim();
      if (titleText.length > 0) return titleText;
      const heading = doc.querySelector("h1");
      const headingText = (heading?.textContent ?? "").trim();
      if (headingText.length > 0) return headingText;
    } catch {
      // fall through to basename
    }
    return basename(path);
  });
}

function buildNavDocument(
  navDir: string,
  paths: string[],
  files: Map<string, Uint8Array>,
  language: string,
): string {
  const labels = labelsForPaths(paths, files);
  const items = paths
    .map((path, index) => {
      const href = esc(relativePath(navDir, path));
      const label = esc(labels[index] ?? basename(path));
      return `        <li><a href="${href}">${label}</a></li>`;
    })
    .join("\n");
  const first = paths[0];
  const startHref = first ? esc(relativePath(navDir, first)) : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(language)}" xml:lang="${esc(language)}">
  <head>
    <title>Contents</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <ol>
${items}
      </ol>
    </nav>
    <nav epub:type="landmarks" hidden="">
      <ol>
        <li><a epub:type="bodymatter" href="${startHref}">Start of Content</a></li>
        <li><a epub:type="toc" href="#toc">Table of Contents</a></li>
      </ol>
    </nav>
  </body>
</html>
`;
}

function uniqueNavId(opf: Opf): string {
  const used = new Set(opf.manifest.map((item) => item.id));
  for (const candidate of ["nav", "a11y-nav", "a11y-nav-doc", "navigation"]) {
    if (!used.has(candidate)) return candidate;
  }
  let counter = 2;
  while (used.has(`a11y-nav-${counter}`)) counter += 1;
  return `a11y-nav-${counter}`;
}

function collectPagebreaks(
  paths: string[],
  navDir: string,
  files: Map<string, Uint8Array>,
): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const path of paths) {
    const bytes = files.get(path);
    if (!bytes) continue;
    const doc = parseDoc(toStr(bytes));
    if (!doc) continue;
    let elements: DomElement[];
    try {
      elements = Array.from(doc.querySelectorAll("*"));
    } catch {
      continue;
    }
    for (const el of elements) {
      const type = el.getAttribute("epub:type") ?? el.getAttribute("role") ?? "";
      const isPagebreak =
        /(^|\s)pagebreak(\s|$)/.test(type) ||
        /(^|\s)doc-pagebreak(\s|$)/.test(type);
      if (!isPagebreak) continue;
      const id = el.getAttribute("id");
      if (!id) continue;
      const text = (el.textContent ?? "").trim() || id;
      out.push({ href: `${relativePath(navDir, path)}#${id}`, text });
    }
  }
  return out;
}

export function fixEpub(data: Uint8Array, options: FixOptions = {}): FixResult {
  const applied: string[] = [];
  const store = readEpub(data);
  const files = new Map<string, Uint8Array>();
  for (const file of store.files) files.set(file.path, file.data);

  const initial = audit(data);
  const present = new Set(initial.issues.map((issue) => issue.code));
  const only = options.only;
  const allowed = (code: string): boolean =>
    only === undefined || only.includes(code);
  const should = (code: string): boolean =>
    present.has(code) && allowed(code);

  let opf: Opf | undefined;
  try {
    opf = parseOpf(store);
  } catch {
    opf = undefined;
  }

  const language = options.language ?? opf?.metadata.language ?? "en";
  const title = options.title ?? opf?.metadata.title ?? "Untitled";

  if (opf) {
    let opfRaw = opf.raw;
    let opfDirty = false;

    if (should("E001")) {
      opfRaw = setDcElement(opfRaw, "dc:language", language);
      opfDirty = true;
      applied.push(`E001: set dc:language to ${language}`);
    }
    if (should("E002")) {
      opfRaw = setDcElement(opfRaw, "dc:title", title);
      opfDirty = true;
      applied.push(`E002: set dc:title to ${title}`);
    }

    const metaFixes: [string, string, string][] = [
      ["E003", "schema:accessMode", "textual"],
      ["E004", "schema:accessModeSufficient", "textual"],
      ["E005", "schema:accessibilityFeature", "structuralNavigation"],
      ["E006", "schema:accessibilityHazard", "none"],
      [
        "W007",
        "schema:accessibilitySummary",
        "This publication contains accessible text, structural navigation, and text alternatives for images.",
      ],
    ];
    for (const [code, property, value] of metaFixes) {
      if (!should(code)) continue;
      if (hasMetaProperty(opfRaw, property)) continue;
      opfRaw = addMetaProperty(opfRaw, property, value);
      opfDirty = true;
      applied.push(`${code}: added meta property ${property}`);
    }

    const docPaths = spineDocPaths(opf);

    if (docPaths.length > 0 && (should("E008") || should("E009"))) {
      let langCount = 0;
      for (const path of docPaths) {
        const bytes = files.get(path);
        if (!bytes) continue;
        const doc = parseDoc(toStr(bytes));
        if (!doc) continue;
        let changed = false;
        if (should("E009")) {
          const root = doc.documentElement;
          if (root) {
            root.setAttribute("lang", language);
            root.setAttribute("xml:lang", language);
            changed = true;
            langCount += 1;
          }
        }
        if (should("E008")) {
          let images: DomElement[] = [];
          try {
            images = Array.from(doc.querySelectorAll("img"));
          } catch {
            images = [];
          }
          for (const image of images) {
            if (image.getAttribute("alt") === null) {
              image.setAttribute("alt", ALT_PLACEHOLDER);
              const src = image.getAttribute("src") ?? "(no src)";
              applied.push(
                `E008: set alt="${ALT_PLACEHOLDER}" on ${path} (img src="${src}")`,
              );
              changed = true;
            }
          }
        }
        if (changed) files.set(path, toBytes(doc.toString()));
      }
      if (langCount > 0) {
        applied.push(
          `E009: set lang and xml:lang to ${language} on ${langCount} document(s)`,
        );
      }
    }

    let nav = undefined as ReturnType<typeof findNavDoc>;
    try {
      nav = findNavDoc(store, opf);
    } catch {
      nav = undefined;
    }

    if (nav && nav.path.length > 0 && !nav.isXhtml) {
      if (should("W010")) {
        applied.push(
          `W010: skipped (navigation document ${nav.path} is NCX, not XHTML)`,
        );
      }
      if (should("W011")) {
        applied.push(
          `W011: skipped (navigation document ${nav.path} is NCX, not XHTML)`,
        );
      }
    } else if (nav && nav.path.length > 0) {
      let navRaw = toStr(files.get(nav.path)) || nav.raw;
      const navDir = dirname(nav.path);
      const firstPath = firstSpinePath(opf);
      const firstHref = firstPath ? relativePath(navDir, firstPath) : undefined;

      if (should("W010") && !/epub:type\s*=\s*["'][^"']*landmarks/i.test(navRaw)) {
        const tocId = findNavId(navRaw, "toc");
        const tocHref = tocId ? `#${tocId}` : basename(nav.path);
        const items: string[] = [];
        if (firstHref) {
          items.push(
            `      <li><a epub:type="bodymatter" href="${esc(firstHref)}">Start of Content</a></li>`,
          );
        }
        items.push(
          `      <li><a epub:type="toc" href="${esc(tocHref)}">Table of Contents</a></li>`,
        );
        const snippet = `    <nav epub:type="landmarks" hidden="">\n      <ol>\n${items.join("\n")}\n      </ol>\n    </nav>`;
        navRaw = insertBeforeBodyClose(navRaw, snippet);
        files.set(nav.path, toBytes(navRaw));
        applied.push("W010: added landmarks nav");
      }

      if (should("W011") && !/epub:type\s*=\s*["'][^"']*page-list/i.test(navRaw)) {
        const pagebreaks = collectPagebreaks(
          docPaths,
          navDir,
          files,
        );
        if (pagebreaks.length > 0) {
          const items = pagebreaks
            .map(
              (entry) =>
                `      <li><a href="${esc(entry.href)}">${esc(entry.text)}</a></li>`,
            )
            .join("\n");
          const snippet = `    <nav epub:type="page-list" hidden="">\n      <ol>\n${items}\n      </ol>\n    </nav>`;
          navRaw = insertBeforeBodyClose(navRaw, snippet);
          files.set(nav.path, toBytes(navRaw));
          applied.push(`W011: added page-list nav with ${pagebreaks.length} entries`);
        }
      }
    }

    if (should("E015") && !nav) {
      const navPath = opf.dir.length > 0 ? `${opf.dir}/nav.xhtml` : "nav.xhtml";
      const navDir = opf.dir;
      const navDoc = buildNavDocument(navDir, docPaths, files, language);
      files.set(navPath, toBytes(navDoc));

      const navId = uniqueNavId(opf);
      const navHref = relativePath(opf.dir, navPath);
      if (/<\/manifest\s*>/i.test(opfRaw)) {
        opfRaw = opfRaw.replace(
          /<\/manifest\s*>/i,
          () =>
            `  <item id="${esc(navId)}" href="${esc(navHref)}" media-type="application/xhtml+xml" properties="nav"/>\n</manifest>`,
        );
      } else if (/<manifest\s*\/>/i.test(opfRaw)) {
        opfRaw = opfRaw.replace(
          /<manifest\s*\/>/i,
          () =>
            `<manifest>\n  <item id="${esc(navId)}" href="${esc(navHref)}" media-type="application/xhtml+xml" properties="nav"/>\n</manifest>`,
        );
      } else {
        opfRaw = `${opfRaw}\n<manifest><item id="${esc(navId)}" href="${esc(navHref)}" media-type="application/xhtml+xml" properties="nav"/></manifest>`;
      }
      opfDirty = true;
      applied.push(`E015: created ${navPath} and registered it in the manifest`);
    }

    if (opfDirty) files.set(opf.path, toBytes(opfRaw));
  }

  const outFiles: EpubFile[] = [];
  const written = new Set<string>();
  for (const file of store.files) {
    written.add(file.path);
    const data2 = files.get(file.path);
    outFiles.push({ path: file.path, data: data2 ?? file.data });
  }
  for (const [path, data2] of files) {
    if (written.has(path)) continue;
    outFiles.push({ path, data: data2 });
  }
  const outStore: EpubStore = {
    files: outFiles,
    list: () => outFiles.map((file) => file.path).sort(),
    get: (path: string) => files.get(path),
  };

  const outData = writeEpub(outStore);
  const remaining = audit(outData).issues;
  return { data: outData, applied, remaining };
}
