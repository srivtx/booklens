import { parseHTML } from "linkedom";
import type {
  EpubFile,
  EpubStore,
  FixOptions,
  FixResult,
  Issue,
  Opf,
} from "./types";
import { readEpub, writeEpub, normalizeMemberPath } from "./zip";
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

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

interface XmlAttribute {
  name: string;
  value: string | null;
}

interface XmlStartTag {
  name: string;
  insertPos: number;
  selfClosing: boolean;
  attributes: XmlAttribute[];
}

function isNameStart(ch: string): boolean {
  return /[A-Za-z_:]/.test(ch);
}

function isNameChar(ch: string): boolean {
  return /[-A-Za-z0-9_:.]/.test(ch);
}

function scanTagEnd(raw: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === undefined) break;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i;
  }
  return -1;
}

function scanDeclarationEnd(raw: string, from: number): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = from; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === undefined) break;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === "]") {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (ch === ">" && depth === 0) return i;
  }
  return -1;
}

function parseAttributes(raw: string, from: number, to: number): XmlAttribute[] {
  const attrs: XmlAttribute[] = [];
  let i = from;
  while (i < to) {
    while (i < to && /\s/.test(raw[i] ?? "")) i += 1;
    if (i >= to) break;
    if (raw[i] === "/") {
      i += 1;
      continue;
    }
    const nameStart = i;
    while (i < to && !/[\s=/]/.test(raw[i] ?? "")) i += 1;
    const name = raw.slice(nameStart, i);
    if (name.length === 0) {
      i += 1;
      continue;
    }
    while (i < to && /\s/.test(raw[i] ?? "")) i += 1;
    let value: string | null = null;
    if (raw[i] === "=") {
      i += 1;
      while (i < to && /\s/.test(raw[i] ?? "")) i += 1;
      const quote = raw[i];
      if (quote === '"' || quote === "'") {
        const valueStart = i + 1;
        i += 1;
        while (i < to && raw[i] !== quote) i += 1;
        value = raw.slice(valueStart, i);
        if (i < to) i += 1;
      } else {
        const valueStart = i;
        while (i < to && !/\s/.test(raw[i] ?? "")) i += 1;
        value = raw.slice(valueStart, i);
      }
    }
    attrs.push({ name, value });
  }
  return attrs;
}

// Scan only element start tags, skipping comments, CDATA, processing
// instructions and declarations so that markup-looking text is never edited.
function scanStartTags(raw: string): XmlStartTag[] {
  const tags: XmlStartTag[] = [];
  let i = 0;
  while (i < raw.length) {
    const lt = raw.indexOf("<", i);
    if (lt === -1) break;
    const next = raw[lt + 1];
    if (next === undefined) break;
    if (next === "!") {
      if (raw.startsWith("<!--", lt)) {
        const close = raw.indexOf("-->", lt + 4);
        i = close === -1 ? raw.length : close + 3;
        continue;
      }
      if (raw.startsWith("<![CDATA[", lt)) {
        const close = raw.indexOf("]]>", lt + 9);
        i = close === -1 ? raw.length : close + 3;
        continue;
      }
      const end = scanDeclarationEnd(raw, lt + 2);
      i = end === -1 ? raw.length : end + 1;
      continue;
    }
    if (next === "?") {
      const close = raw.indexOf("?>", lt + 2);
      i = close === -1 ? raw.length : close + 2;
      continue;
    }
    if (next === "/") {
      const end = scanTagEnd(raw, lt + 2);
      i = end === -1 ? raw.length : end + 1;
      continue;
    }
    if (!isNameStart(next)) {
      i = lt + 1;
      continue;
    }
    const end = scanTagEnd(raw, lt + 1);
    if (end === -1) break;
    let nameEnd = lt + 1;
    while (nameEnd < end && isNameChar(raw[nameEnd] ?? "")) nameEnd += 1;
    const name = raw.slice(lt + 1, nameEnd);
    let k = end - 1;
    while (k > lt && /\s/.test(raw[k] ?? "")) k -= 1;
    const selfClosing = raw[k] === "/";
    const insertPos = selfClosing ? k : end;
    const attributes = parseAttributes(raw, nameEnd, insertPos);
    tags.push({ name: name.toLowerCase(), insertPos, selfClosing, attributes });
    i = end + 1;
  }
  return tags;
}

interface XmlRewriteResult {
  raw: string;
  changed: boolean;
  langSet: boolean;
  imagesFixed: { src: string }[];
}

// A minimal, well-formedness-preserving edit: it never round-trips the
// document, so the XML declaration, namespaces and entities are untouched.
// It only self-closes XML void elements and injects the requested attributes.
function rewriteSpineDocument(
  raw: string,
  opts: { setLanguage?: string; addAlt: boolean; altPlaceholder: string },
): XmlRewriteResult {
  const tags = scanStartTags(raw);
  const edits: { pos: number; text: string }[] = [];
  const imagesFixed: { src: string }[] = [];
  let sawHtml = false;
  let langSet = false;

  for (const tag of tags) {
    const names = new Set(tag.attributes.map((attr) => attr.name.toLowerCase()));
    let insertion = "";

    if (opts.setLanguage !== undefined && !sawHtml && tag.name === "html") {
      sawHtml = true;
      if (!names.has("lang")) {
        insertion += ` lang="${esc(opts.setLanguage)}"`;
        langSet = true;
      }
      if (!names.has("xml:lang")) {
        insertion += ` xml:lang="${esc(opts.setLanguage)}"`;
        langSet = true;
      }
    }

    if (tag.name === "img" && opts.addAlt && !names.has("alt")) {
      const src = tag.attributes.find((attr) => attr.name.toLowerCase() === "src");
      insertion += ` alt="${esc(opts.altPlaceholder)}"`;
      if (!tag.selfClosing) insertion += "/";
      imagesFixed.push({ src: src?.value ?? "(no src)" });
    } else if (VOID_ELEMENTS.has(tag.name) && !tag.selfClosing) {
      insertion += "/";
    }

    if (insertion.length > 0) edits.push({ pos: tag.insertPos, text: insertion });
  }

  if (edits.length === 0) {
    return { raw, changed: false, langSet, imagesFixed };
  }

  edits.sort((a, b) => b.pos - a.pos);
  let out = raw;
  for (const edit of edits) {
    out = out.slice(0, edit.pos) + edit.text + out.slice(edit.pos);
  }
  return { raw: out, changed: true, langSet, imagesFixed };
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
  const skipped: string[] = [];
  const store = readEpub(data, options.limits);
  const files = new Map<string, Uint8Array>();
  for (const file of store.files) files.set(file.path, file.data);

  const initial = audit(data, "document.epub", options.limits);
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
      const setLanguage = should("E009") ? language : undefined;
      let langCount = 0;
      for (const path of docPaths) {
        const bytes = files.get(path);
        if (!bytes) continue;
        const rewrite = rewriteSpineDocument(toStr(bytes), {
          ...(setLanguage !== undefined ? { setLanguage } : {}),
          addAlt: should("E008"),
          altPlaceholder: ALT_PLACEHOLDER,
        });
        if (rewrite.langSet) langCount += 1;
        for (const image of rewrite.imagesFixed) {
          applied.push(
            `E008: set alt="${ALT_PLACEHOLDER}" on ${path} (img src="${image.src}")`,
          );
        }
        if (rewrite.changed) files.set(path, toBytes(rewrite.raw));
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
        skipped.push(
          `W010: skipped (navigation document ${nav.path} is NCX, not XHTML)`,
        );
      }
      if (should("W011")) {
        skipped.push(
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
      const navPath = normalizeMemberPath(
        opf.dir.length > 0 ? `${opf.dir}/nav.xhtml` : "nav.xhtml",
      );
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
  return { data: outData, applied, skipped, remaining };
}
