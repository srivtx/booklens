import type { EpubStore, NavDoc, Opf } from "./types";
import { resolveHref } from "./opf";

const decoder = new TextDecoder("utf-8");

const LANDMARKS_RE = /epub:type="landmarks"|role="doc-landmarks"/;
const TOC_RE = /epub:type="toc"/;
const PAGE_LIST_RE = /epub:type="page-list"/;

function hasNavProperty(properties: string): boolean {
  return properties.split(/\s+/).includes("nav");
}

export function findNavDoc(store: EpubStore, opf: Opf): NavDoc | undefined {
  let item = opf.manifest.find((entry) => hasNavProperty(entry.properties));
  if (!item) {
    item = opf.manifest.find(
      (entry) => entry.mediaType === "application/x-dtbncx+xml",
    );
  }
  if (!item || item.href.length === 0) return undefined;

  const path = resolveHref(opf.dir, item.href);
  const bytes = store.get(path);
  if (!bytes) return undefined;

  const raw = decoder.decode(bytes);

  const firstSpine = opf.spine[0];
  let tocContainsFirst = false;
  if (firstSpine) {
    const firstItem = opf.manifest.find(
      (entry) => entry.id === firstSpine.idref,
    );
    if (firstItem && firstItem.href.length > 0) {
      const firstHref = resolveHref(opf.dir, firstItem.href);
      const base = firstHref.split("/").pop();
      tocContainsFirst =
        raw.includes(firstHref) ||
        (typeof base === "string" && base.length > 0 && raw.includes(base));
    }
  }

  return {
    path,
    hasLandmarks: LANDMARKS_RE.test(raw),
    hasToc: TOC_RE.test(raw) || tocContainsFirst,
    hasPageList: PAGE_LIST_RE.test(raw),
    raw,
  };
}
