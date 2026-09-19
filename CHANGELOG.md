# Changelog

## [0.1.0] — 2026-09-19

First release.

### Added

- **Audit**: 15 rules across metadata, language, images, navigation, headings,
  tables, and links, each mapped to a WCAG criterion where one applies. Works on
  the OPF, the nav/NCX, and every spine XHTML document.
- **Fix**: writes a corrected EPUB — required `dc:language`/`dc:title`, the five
  `schema:*` accessibility metas, `lang`/`xml:lang` on documents, decorative
  `alt=""` placeholders, a landmarks nav, a page-list from pagebreaks, and a
  generated navigation document when one is missing. Re-audits and reports the
  remaining issues.
- **CLI**: `audit` and `fix` with `--json`, `--dry-run`, `--only`, `--language`,
  and `--title`.
- **Library API**: `audit`, `fixEpub`, and the parsers, for use in a pipeline.
- Zero network code and a dependency set of three pure-JS packages.
