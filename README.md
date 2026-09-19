<div align="center">

# booklens

**Audit EPUB accessibility and write a fixed EPUB — offline, in one command.**

[![CI](https://github.com/srivtx/booklens/actions/workflows/ci.yml/badge.svg)](https://github.com/srivtx/booklens/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/srivtx/booklens?sort=semver&color=4f46e5)](https://github.com/srivtx/booklens/releases)
[![license](https://img.shields.io/badge/license-MIT-0f766e)](LICENSE)
[![runtime](https://img.shields.io/badge/runtime-Bun-14151A?logo=bun&logoColor=white)](https://bun.sh)
[![types](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![tests](https://img.shields.io/badge/tests-10-0f766e)](#testing)
[![network](https://img.shields.io/badge/network-none-0f766e)](#privacy)

</div>

---

**Live site:** [booklens](https://lens-site-srivtx.vercel.app/booklens.html)  ·  **Playground:** [https://lens-site-srivtx.vercel.app/playground](https://lens-site-srivtx.vercel.app/playground)  ·  **Source:** [github.com/srivtx/booklens](https://github.com/srivtx/booklens)

## Website

The standalone product site and in-browser playground live at
[https://booklens-srivtx.vercel.app](https://booklens-srivtx.vercel.app).

Preview it locally:

```bash
bun run build:site   # bundle src/index.ts into site/assets/demo.js
bun run check:site   # verify links, classes, and page structure
bunx serve site      # or: python3 -m http.server -d site 8080
```

The `#playground` section audits real EPUB bytes with the same rules as the
CLI, entirely in the browser. Nothing is uploaded.

## The problem

EPUB accessibility tooling splits into two halves that never meet.

**Auditing is solved.** [DAISY ACE](https://github.com/daisy/ace) reports on
EPUB Accessibility 1.1 and WCAG 2.x, and [EPUBCheck](https://github.com/w3c/epubcheck)
validates conformance. Both are excellent, maintained, offline tools.

**Fixing is not.** Neither writes a corrected book. The only thing that repairs
content is [Access-Aide](https://github.com/kevinhendricks/Access-Aide), a Sigil
*GUI plugin*: it is not scriptable, it cannot run in CI, and it pauses for manual
alt-text entry. The one project advertising a one-command fixer has zero stars,
no license file, and has never been published to npm.

`booklens` closes that half. It audits a book and emits a repaired EPUB, so
accessibility work runs in a pipeline instead of a desktop application.

## Install

```bash
bun install
# run it straight from source
bun run src/cli.ts audit book.epub
```

## Usage

```bash
# Audit — human output, exit 1 if there are any errors
booklens audit book.epub

# Audit — machine-readable for CI
booklens audit book.epub --json

# Fix — write a corrected EPUB
booklens fix book.epub -o book.fixed.epub --language en --title "My Book"

# Preview the fixes without writing anything
booklens fix book.epub --dry-run

# Apply only selected fixes
booklens fix book.epub --only E001,E002,W010
```

### Library

```ts
import { audit, fixEpub } from "booklens";

const report = audit(bytes, "book.epub");

if (report.counts.error > 0) {
  const { data, applied, remaining } = fixEpub(bytes, {
    language: "en",
    title: "My Book",
  });
  // data: corrected EPUB bytes, applied: changelog, remaining: re-audit issues
}
```

## What it checks

| Code | Severity | WCAG | Check | Auto-fixed |
|---|---|---|---|---|
| E001 | error | 3.1.1 | Missing `dc:language` | yes |
| E002 | error | — | Missing `dc:title` | yes |
| E003 | error | 1.1.1 | Missing `schema:accessMode` | yes |
| E004 | error | — | Missing `schema:accessModeSufficient` | yes |
| E005 | error | — | Missing `schema:accessibilityFeature` | yes |
| E006 | error | — | Missing `schema:accessibilityHazard` | yes |
| W007 | warning | — | Missing `schema:accessibilitySummary` | yes |
| E008 | error | 1.1.1 | Image without `alt` | yes (placeholder) |
| E009 | error | 3.1.1 | `<html>` without `lang` | yes |
| W010 | warning | 1.3.1 | Navigation missing a landmarks nav | yes |
| W011 | info | 1.3.1 | Navigation missing a page-list (when pagebreaks exist) | yes |
| W012 | warning | 1.3.1 | Heading levels skip | reported |
| W013 | warning | 1.3.1 | Table without header cells | reported |
| W014 | warning | 2.4.4 | Link text is a raw URL | reported |
| E015 | error | 1.3.1 | No navigation document | yes |

The rules that are **reported but not auto-fixed** are the ones where a repair
would require judgement. Guessing a heading level or a link label silently
corrupts the book; `booklens` leaves those to a human and says so.

## What `fix` actually does

- Adds `dc:language`, `dc:title`, and the five `schema:*` accessibility metas.
- Sets `lang` and `xml:lang` on every spine document.
- Adds `alt=""` to images that have no `alt` attribute, and lists every one in
  the change log so a human can fill in real text.
- Adds a landmarks nav, builds a page-list when the book has pagebreaks, and
  generates a whole navigation document when the book has none.
- Re-audits the result and returns the **remaining** issues, so a pipeline can
  tell "fixed" from "fixed and verified".

## How it works

```
book.epub ──unzip──▶ OPF (metadata, manifest, spine)
                     ├── nav / NCX  → landmarks, toc, page-list
                     └── spine XHTML → linkedom → rules
                                          │
                     fix ◀───────────────┘
                       └── rewrite OPF + documents + nav ──▶ book.fixed.epub
```

`src/zip.ts` writes the EPUB with `mimetype` first and uncompressed, as the spec
requires. `src/rules.ts` is pure and testable; `src/fix.ts` never throws and
always returns the best archive it could produce.

## CI

```yaml
- run: booklens audit public/book.epub
# exits 1 on any error-severity issue
```

## SARIF and code scanning

Emit a [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)
log and let GitHub code scanning annotate the pull request:

```bash
booklens audit book.epub --sarif booklens.sarif
```

```yaml
- run: bunx booklens audit public/book.epub --sarif booklens.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: booklens.sarif
```

`--fail-on` controls when the command exits non-zero and defaults to `error`.
Pass `warning`, `info`, or `none` to loosen it:

```bash
booklens audit book.epub --fail-on warning
```

`fix` accepts the same `--sarif` and `--fail-on` flags; its SARIF report
describes the issues remaining after the fix.

## Testing

| Gate | Result |
|---|---|
| `bun test` | 10 tests |
| `bunx tsc --noEmit` | clean (strict) |
| fixtures | `bun run make-fixtures` writes a broken and a clean EPUB |
| round trip | `fix` → `audit` ends with zero errors |

The suite includes a zip round-trip that asserts the `mimetype` member is first
and stored, a rule test against a fixture with known defects, and an
end-to-end fix that re-audits the output.

## Privacy

No network code. Everything is local unzip, XML, and HTML parsing.

## Limitations

- Fixes metadata, language, alt placeholders, and navigation. It does not do
  layout or reading-order repair, and it will not invent alt text.
- PDF and Office formats are handled by sibling tools (see below), not here.

## The suite

- **booklens** — EPUB accessibility audit and fix *(this repo)*
- **officelens** — DOCX/PPTX accessibility audit
- **odflens** — ODT/ODS/ODP accessibility audit
- **iconlens** — standalone SVG accessibility lint
- **waxseal** — detached Ed25519 seal for WACZ web archives

## License

[MIT](LICENSE).
