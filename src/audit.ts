import type { AuditResult, EpubStore, NavDoc, Opf } from "./types";
import { parseOpf } from "./opf";
import { findNavDoc } from "./nav";
import { readEpub, type UnzipLimits } from "./zip";
import { runRules } from "./rules";

export function audit(
  data: Uint8Array,
  file = "document.epub",
  limits?: UnzipLimits,
): AuditResult {
  const store: EpubStore = readEpub(data, limits);

  let opf: Opf | undefined;
  try {
    opf = parseOpf(store);
  } catch {
    opf = undefined;
  }

  let nav: NavDoc | undefined;
  try {
    nav = opf ? findNavDoc(store, opf) : undefined;
  } catch {
    nav = undefined;
  }

  const language = opf?.metadata?.language ?? "en";
  const issues = runRules({ store, opf, nav, language });

  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) {
    if (issue.severity === "error") counts.error += 1;
    else if (issue.severity === "warning") counts.warning += 1;
    else counts.info += 1;
  }

  return { file, issues, counts };
}
