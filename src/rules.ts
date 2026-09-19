import { parseHTML } from "linkedom";
import type {
  EpubStore,
  Issue,
  ManifestItem,
  NavDoc,
  Opf,
  Severity,
} from "./types";
import { resolveHref } from "./opf";

export interface RuleContext {
  store: EpubStore;
  opf: Opf | undefined;
  nav: NavDoc | undefined;
  language: string;
}

interface HtmlElementLike {
  tagName?: string;
  textContent?: string | null;
  getAttribute(name: string): string | null;
  querySelectorAll?(selector: string): ArrayLike<HtmlElementLike>;
}

interface HtmlDoc {
  documentElement: HtmlElementLike | null;
  querySelectorAll(selector: string): ArrayLike<HtmlElementLike>;
}

interface SpineDoc {
  path: string;
  html: string;
  doc: HtmlDoc | undefined;
}

function mk(
  code: string,
  severity: Severity,
  message: string,
  location: string,
  fixable: boolean,
  wcag?: string,
): Issue {
  const issue = { code, severity, message, location, fixable } as Issue;
  if (wcag !== undefined) issue.wcag = wcag;
  return issue;
}

function metaValue(opf: Opf, key: string): string | undefined {
  const meta = opf.metadata.meta ?? {};
  const direct = meta[key];
  if (typeof direct === "string" && direct.trim() !== "") return direct;
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(meta)) {
    if (k.toLowerCase() === lower && typeof v === "string" && v.trim() !== "") {
      return v;
    }
  }
  return undefined;
}

interface DecoderCtor {
  new (label?: string): { decode(input?: Uint8Array): string };
}

function decodeBytes(bytes: Uint8Array): string {
  const scope = globalThis as unknown as { TextDecoder?: DecoderCtor };
  if (scope.TextDecoder) {
    try {
      return new scope.TextDecoder("utf-8").decode(bytes);
    } catch {
      // fall through to a byte-wise decode
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}

function decode(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw;
  if (raw instanceof Uint8Array) {
    try {
      return decodeBytes(raw);
    } catch {
      return undefined;
    }
  }
  try {
    return String(raw);
  } catch {
    return undefined;
  }
}

function parseDoc(html: string): HtmlDoc | undefined {
  try {
    const win = parseHTML(html) as unknown as { document?: HtmlDoc };
    return win ? win.document : undefined;
  } catch {
    return undefined;
  }
}

function getRaw(store: EpubStore, path: string): unknown {
  try {
    return store.get(path) as unknown;
  } catch {
    return undefined;
  }
}

function spineDocs(ctx: RuleContext): SpineDoc[] {
  const opf = ctx.opf;
  if (!opf) return [];
  const out: SpineDoc[] = [];
  try {
    const byId = new Map<string, ManifestItem>();
    for (const item of opf.manifest) byId.set(item.id, item);
    const seen = new Set<string>();
    for (const item of opf.spine) {
      const manifestItem = byId.get(item.idref);
      if (!manifestItem) continue;
      const mediaType = manifestItem.mediaType.toLowerCase();
      if (mediaType !== "application/xhtml+xml" && mediaType !== "text/html") {
        continue;
      }
      let path: string;
      try {
        path = resolveHref(opf.dir, manifestItem.href);
      } catch {
        continue;
      }
      if (seen.has(path)) continue;
      seen.add(path);
      const html = decode(getRaw(ctx.store, path)) ?? "";
      out.push({ path, html, doc: parseDoc(html) });
    }
  } catch {
    return out;
  }
  return out;
}

function hasPagebreaks(ctx: RuleContext): boolean {
  try {
    for (const doc of spineDocs(ctx)) {
      if (/epub:type\s*=\s*["'][^"']*\bpagebreak\b/i.test(doc.html)) {
        return true;
      }
      if (/role\s*=\s*["']doc-pagebreak["']/i.test(doc.html)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function headingLevel(el: HtmlElementLike): number {
  const tag = (el.tagName ?? "").toLowerCase();
  const match = /^h([1-6])$/.exec(tag);
  return match && match[1] ? Number(match[1]) : 0;
}

export function ruleE001(ctx: RuleContext): Issue[] {
  const opf = ctx.opf;
  if (!opf) return [];
  const language = opf.metadata.language;
  if (typeof language === "string" && language.trim() !== "") return [];
  return [
    mk(
      "E001",
      "error",
      "Publication is missing a dc:language declaration.",
      opf.path,
      true,
      "3.1.1",
    ),
  ];
}

export function ruleE002(ctx: RuleContext): Issue[] {
  const opf = ctx.opf;
  if (!opf) return [];
  const title = opf.metadata.title;
  if (typeof title === "string" && title.trim() !== "") return [];
  return [
    mk(
      "E002",
      "error",
      "Publication is missing a dc:title declaration.",
      opf.path,
      true,
      "2.4.2",
    ),
  ];
}

export function ruleE003(ctx: RuleContext): Issue[] {
  const opf = ctx.opf;
  if (!opf) return [];
  if (metaValue(opf, "schema:accessMode")) return [];
  return [
    mk(
      "E003",
      "error",
      "Publication is missing schema:accessMode metadata.",
      opf.path,
      true,
      "1.3.1",
    ),
  ];
}

export function ruleE004(ctx: RuleContext): Issue[] {
  const opf = ctx.opf;
  if (!opf) return [];
  if (metaValue(opf, "schema:accessModeSufficient")) return [];
  return [
    mk(
      "E004",
      "error",
      "Publication is missing schema:accessModeSufficient metadata.",
      opf.path,
      true,
      "1.3.1",
    ),
  ];
}

export function ruleE005(ctx: RuleContext): Issue[] {
  const opf = ctx.opf;
  if (!opf) return [];
  if (metaValue(opf, "schema:accessibilityFeature")) return [];
  return [
    mk(
      "E005",
      "error",
      "Publication is missing schema:accessibilityFeature metadata.",
      opf.path,
      true,
      "1.3.1",
    ),
  ];
}

export function ruleE006(ctx: RuleContext): Issue[] {
  const opf = ctx.opf;
  if (!opf) return [];
  if (metaValue(opf, "schema:accessibilityHazard")) return [];
  return [
    mk(
      "E006",
      "error",
      "Publication is missing schema:accessibilityHazard metadata.",
      opf.path,
      true,
      "1.3.1",
    ),
  ];
}

export function ruleW007(ctx: RuleContext): Issue[] {
  const opf = ctx.opf;
  if (!opf) return [];
  if (metaValue(opf, "schema:accessibilitySummary")) return [];
  return [
    mk(
      "W007",
      "warning",
      "Publication is missing schema:accessibilitySummary metadata.",
      opf.path,
      true,
      "1.3.1",
    ),
  ];
}

export function ruleE008(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const doc of spineDocs(ctx)) {
    if (!doc.doc) continue;
    try {
      const images = Array.from(doc.doc.querySelectorAll("img"));
      // alt="" is valid (decorative), so only a MISSING alt attribute counts.
      const missing = images.filter((el) => el.getAttribute("alt") === null);
      if (missing.length > 0) {
        issues.push(
          mk(
            "E008",
            "error",
            `${missing.length} image(s) missing an alt attribute.`,
            doc.path,
            true,
            "1.1.1",
          ),
        );
      }
    } catch {
      continue;
    }
  }
  return issues;
}

export function ruleE009(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const doc of spineDocs(ctx)) {
    if (!doc.doc) continue;
    try {
      let html = doc.doc.documentElement;
      if (!html) {
        const found = Array.from(doc.doc.querySelectorAll("html"))[0];
        html = found ?? null;
      }
      if (!html) continue;
      const lang = html.getAttribute("lang");
      const xmlLang = html.getAttribute("xml:lang");
      const hasLang = (lang ?? "").trim() !== "";
      const hasXmlLang = (xmlLang ?? "").trim() !== "";
      if (!hasLang && !hasXmlLang) {
        issues.push(
          mk(
            "E009",
            "error",
            "html element is missing both lang and xml:lang attributes.",
            doc.path,
            true,
            "3.1.1",
          ),
        );
      }
    } catch {
      continue;
    }
  }
  return issues;
}

export function ruleW010(ctx: RuleContext): Issue[] {
  const nav = ctx.nav;
  if (!nav || nav.hasLandmarks) return [];
  return [
    mk(
      "W010",
      "warning",
      "Navigation document is missing a landmarks nav element.",
      nav.path,
      true,
      "1.3.1",
    ),
  ];
}

export function ruleW011(ctx: RuleContext): Issue[] {
  const nav = ctx.nav;
  if (!nav || nav.hasPageList) return [];
  const pagebreaks = hasPagebreaks(ctx);
  const severity: Severity = pagebreaks ? "warning" : "info";
  const message = pagebreaks
    ? "Navigation document is missing a page-list but the publication contains pagebreaks."
    : "Navigation document has no page-list; the publication contains no pagebreaks.";
  return [mk("W011", severity, message, nav.path, pagebreaks, "1.3.1")];
}

export function ruleW012(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const doc of spineDocs(ctx)) {
    if (!doc.doc) continue;
    try {
      const headings = Array.from(
        doc.doc.querySelectorAll("h1,h2,h3,h4,h5,h6"),
      );
      if (headings.length === 0) continue;
      const levels = headings.map(headingLevel);
      const first = levels[0];
      let skip = first !== 1;
      if (!skip) {
        for (let i = 1; i < levels.length; i += 1) {
          const prev = levels[i - 1];
          const current = levels[i];
          if (prev !== undefined && current !== undefined && current > prev + 1) {
            skip = true;
            break;
          }
        }
      }
      if (skip) {
        issues.push(
          mk(
            "W012",
            "warning",
            "Headings skip a level or do not begin with an h1.",
            doc.path,
            false,
            "1.3.1",
          ),
        );
      }
    } catch {
      continue;
    }
  }
  return issues;
}

export function ruleW013(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const doc of spineDocs(ctx)) {
    if (!doc.doc) continue;
    try {
      const tables = Array.from(doc.doc.querySelectorAll("table"));
      for (const table of tables) {
        const cells = table.querySelectorAll?.("th");
        let hasHeader = cells !== undefined && cells.length > 0;
        if (!hasHeader) {
          const roleHeaders = table.querySelectorAll?.('[role="columnheader"]');
          hasHeader = roleHeaders !== undefined && roleHeaders.length > 0;
        }
        if (!hasHeader) {
          issues.push(
            mk(
              "W013",
              "warning",
              'Table has no header cells (no <th> or role="columnheader").',
              doc.path,
              false,
              "1.3.1",
            ),
          );
        }
      }
    } catch {
      continue;
    }
  }
  return issues;
}

export function ruleW014(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const doc of spineDocs(ctx)) {
    if (!doc.doc) continue;
    try {
      const anchors = Array.from(doc.doc.querySelectorAll("a"));
      for (const anchor of anchors) {
        const text = (anchor.textContent ?? "").trim();
        if (/^https?:\/\//.test(text)) {
          const display = text.length > 60 ? `${text.slice(0, 57)}...` : text;
          issues.push(
            mk(
              "W014",
              "warning",
              `Link text is a raw URL: ${display}`,
              doc.path,
              true,
              "2.4.4",
            ),
          );
        }
      }
    } catch {
      continue;
    }
  }
  return issues;
}

export function ruleE015(ctx: RuleContext): Issue[] {
  if (ctx.nav) return [];
  const opf = ctx.opf;
  if (opf) {
    for (const item of opf.manifest) {
      const mediaType = item.mediaType.toLowerCase();
      if (mediaType.includes("dtbncx") || /\.ncx$/i.test(item.href)) return [];
    }
  }
  return [
    mk(
      "E015",
      "error",
      "Publication is missing a navigation document.",
      opf ? opf.path : "content.opf",
      true,
      "2.4.1",
    ),
  ];
}

export function runRules(ctx: RuleContext): Issue[] {
  const rules = [
    ruleE001,
    ruleE002,
    ruleE003,
    ruleE004,
    ruleE005,
    ruleE006,
    ruleW007,
    ruleE008,
    ruleE009,
    ruleW010,
    ruleW011,
    ruleW012,
    ruleW013,
    ruleW014,
    ruleE015,
  ];
  const all: Issue[] = [];
  for (const rule of rules) {
    try {
      all.push(...rule(ctx));
    } catch {
      continue;
    }
  }
  all.sort((a, b) =>
    a.location === b.location
      ? a.code.localeCompare(b.code)
      : a.location.localeCompare(b.location),
  );
  return all;
}
