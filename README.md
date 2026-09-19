<div align="center">

# epub-a11y

**Audit EPUB accessibility and write a fixed EPUB — offline, in one command.**

[![CI](https://github.com/srivtx/epub-a11y/actions/workflows/ci.yml/badge.svg)](https://github.com/srivtx/epub-a11y/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-0f766e)](LICENSE)
[![runtime](https://img.shields.io/badge/runtime-Bun-14151A?logo=bun&logoColor=white)](https://bun.sh)
[![tests](https://img.shields.io/badge/tests-10-0f766e)](#testing)
[![offline](https://img.shields.io/badge/network-none-0f766e)](#privacy)

</div>

---

## The gap

Accessibility **auditing** for EPUB is solved: DAISY ACE reports on EPUB
Accessibility 1.1 and WCAG 2.x, and EPUBCheck validates conformance. Neither
**writes a corrected book**. The only thing that fixes content is Access-Aide, a
Sigil GUI plugin: not scriptable, not CI-usable, and it stalls for manual alt-text
entry. The one repository that claims a one-command fixer has zero stars, no
license, and no npm release.

`epub-a11y` fills that gap: an offline library and CLI that audits a book and
emits a repaired EPUB, so accessibility work can run in a pipeline instead of a
GUI.

## Install

```bash
bun install
# or use the CLI directly
bun run src/cli.ts audit book.epub
```

## Usage

```bash
# Audit (human-readable; exit 1 if any errors)
epub-a11y audit book.epub
epub-a11y audit book.epub --json      # machine-readable for CI

# Fix — writes a corrected EPUB
epub-a11y fix book.epub -o book.fixed.epub --language en --title "My Book"
epub-a11y fix book.epub --dry-run      # show what would change
epub-a11y fix book.epub --only E001,E002,W010
```

```ts
import { audit, fixEpub } from "epub-a11y";

const report = audit(bytes, "book.epub");
if (report.counts.error > 0) {
  const { data, applied, remaining } = fixEpub(bytes, { language: "en" });
}
```

## Rules

| Code | Severity | WCAG | Checks |
|---|---|---|---|
| E001 | error | 3.1.1 | Missing `dc:language` |
| E002 | error | — | Missing `dc:title` |
| E003 | error | 1.1.1 | Missing `schema:accessMode` |
| E004 | error | — | Missing `schema:accessModeSufficient` |
| E005 | error | — | Missing `schema:accessibilityFeature` |
| E006 | error | — | Missing `schema:accessibilityHazard` |
| W007 | warning | — | Missing `schema:accessibilitySummary` |
| E008 | error | 1.1.1 | Image without `alt` |
| E009 | error | 3.1.1 | `<html>` without `lang` |
| W010 | warning | 1.3.1 | Nav missing landmarks |
| W011 | info | 1.3.1 | Nav missing page-list (when pagebreaks exist) |
| W012 | warning | 1.3.1 | Heading level skip |
| W013 | warning | 1.3.1 | Table without header cells |
| W014 | warning | 2.4.4 | Link text is a raw URL |
| E015 | error | 1.3.1 | No navigation document |

Codes marked fixable are repaired by `fix`: metadata and `lang`, image `alt`
(empty = decorative placeholder), landmarks, and a generated nav document.
Heading-order, table-header, and link-text issues are reported but left to a
human, because guessing would be wrong.

## What fix actually does

- Adds `dc:language`, `dc:title`, and the five `schema:*` accessibility metas.
- Sets `lang` and `xml:lang` on every spine document.
- Adds `alt=""` to images that have no `alt` attribute (flagged in the change
  list so they can be reviewed).
- Adds a landmarks nav, a page-list when pagebreaks exist, and a whole nav
  document when the book has none.
- Re-audits the result and reports what remains.

## Privacy

There is **no network code**. Everything is local unzip, XML, and HTML parsing.

## Testing

```bash
bun run typecheck
bun test
bun run make-fixtures
bun run src/cli.ts audit fixtures/inaccessible.epub
```

10 tests cover zip round-trips (mimetype first and uncompressed), the OPF/NAV
parsers, every rule against a fixture with known defects and a clean fixture,
and a full `fix` → `audit` round-trip that ends with zero errors.

## Acknowledgements

Rule scope follows DAISY ACE and the EPUB Accessibility 1.1 spec. Fix behavior
is modeled on Access-Aide's catalog, reimplemented headlessly.

## License

[MIT](LICENSE).
