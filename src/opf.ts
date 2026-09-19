import { XMLParser } from "fast-xml-parser";
import type {
  EpubStore,
  ManifestItem,
  Opf,
  OpfMetadata,
  SpineItem,
} from "./types";

const decoder = new TextDecoder("utf-8");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) =>
    name === "rootfile" ||
    name === "item" ||
    name === "itemref" ||
    name === "meta",
});

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const record = asRecord(value);
  if (record) {
    const text = record["#text"];
    if (typeof text === "string") return text;
    if (typeof text === "number" || typeof text === "boolean") {
      return String(text);
    }
  }
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = textOf(entry);
      if (text !== undefined) return text;
    }
    return undefined;
  }
  return textOf(value);
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "" : path.slice(0, slash);
}

export function findOpfPath(store: EpubStore): string | undefined {
  const container = store.get("META-INF/container.xml");
  if (!container) return undefined;

  let parsed: unknown;
  try {
    parsed = parser.parse(decoder.decode(container));
  } catch {
    return undefined;
  }

  const root = asRecord(parsed);
  const containerNode = asRecord(root?.["container"]);
  const rootfiles = asRecord(containerNode?.["rootfiles"]);

  for (const entry of toArray(rootfiles?.["rootfile"])) {
    const record = asRecord(entry);
    const fullPath = record?.["@_full-path"];
    if (typeof fullPath === "string" && fullPath.length > 0) {
      return fullPath;
    }
  }

  return undefined;
}

export function parseOpf(store: EpubStore): Opf | undefined {
  const path = findOpfPath(store);
  if (!path) return undefined;

  const bytes = store.get(path);
  if (!bytes) return undefined;

  const raw = decoder.decode(bytes);

  let parsed: unknown;
  try {
    parsed = parser.parse(raw);
  } catch {
    return undefined;
  }

  const root = asRecord(parsed);
  const pkg = asRecord(root?.["package"]);
  if (!pkg) return undefined;

  const metadataNode = asRecord(pkg["metadata"]) ?? {};
  const manifestNode = asRecord(pkg["manifest"]) ?? {};
  const spineNode = asRecord(pkg["spine"]) ?? {};

  const meta: Record<string, string> = {};
  for (const entry of toArray(metadataNode["meta"])) {
    const record = asRecord(entry);
    if (!record) continue;

    const property = record["@_property"];
    const name = record["@_name"];

    if (typeof property === "string") {
      const text = textOf(record);
      if (text !== undefined) meta[property] = text;
    } else if (typeof name === "string") {
      const content = record["@_content"];
      if (typeof content === "string") {
        meta[name] = content;
      } else {
        const text = textOf(record);
        if (text !== undefined) meta[name] = text;
      }
    }
  }

  const metadata: OpfMetadata = {
    title: firstString(metadataNode["title"]),
    language: firstString(metadataNode["language"]),
    identifier: firstString(metadataNode["identifier"]),
    meta,
  };

  const manifest: ManifestItem[] = [];
  for (const entry of toArray(manifestNode["item"])) {
    const record = asRecord(entry);
    if (!record) continue;

    const id = record["@_id"];
    const href = record["@_href"];
    const mediaType = record["@_media-type"];
    const properties = record["@_properties"];

    manifest.push({
      id: typeof id === "string" ? id : "",
      href: typeof href === "string" ? href : "",
      mediaType: typeof mediaType === "string" ? mediaType : "",
      properties: typeof properties === "string" ? properties : "",
    });
  }

  const spine: SpineItem[] = [];
  for (const entry of toArray(spineNode["itemref"])) {
    const record = asRecord(entry);
    if (!record) continue;

    const idref = record["@_idref"];
    const linear = record["@_linear"];

    spine.push({
      idref: typeof idref === "string" ? idref : "",
      linear: !(typeof linear === "string" && linear.toLowerCase() === "no"),
    });
  }

  return {
    path,
    dir: dirOf(path),
    metadata,
    manifest,
    spine,
    raw,
  };
}

export function resolveHref(dir: string, href: string): string {
  let target = href;
  const hash = target.indexOf("#");
  if (hash !== -1) target = target.slice(0, hash);
  const query = target.indexOf("?");
  if (query !== -1) target = target.slice(0, query);

  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    decoded = target;
  }

  const base = dir.replace(/\/+$/, "");
  const combined = base.length > 0 ? `${base}/${decoded}` : decoded;

  const parts: string[] = [];
  for (const part of combined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}
