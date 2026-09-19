# Changelog

## [0.2.0] - 2026-09-20

Production-hardening pass. No rule semantics changed; the fixes close gaps
between the audit report and what the tool actually writes and ships.

### Fixed

- **Unreadable input now exits 2.** A missing, corrupt, or non-EPUB file is
  reported as a usage/read failure (exit 2) instead of being audited as an
  empty document or crashing with a stack trace.
- **E015 fix writes the nav.** When a book is missing its navigation document,
  the generated nav is now written into the manifest and the spine, so the
  repaired EPUB is actually navigable. Previously the issue was reported but
  nothing was persisted.
- **NCX is no longer corrupted.** The NCX rewrite preserves the existing
  `navMap` structure and escaping instead of flattening it into invalid markup.
- **E008 writes a real TODO placeholder.** A missing `alt` attribute is fixed
  with a descriptive TODO placeholder rather than silently dropped, so the
  remaining work is visible in the output book.

### Added

- **CLI validation** for `--fail-on`, `--only`, and command arguments, with a
  clear usage message and exit 1 on bad input.
- **CI bundle-drift gate** that rebuilds the site bundle and fails if the
  committed `site/assets/demo.js` is out of date.

[0.2.0]: https://github.com/srivtx/booklens/compare/v0.1.0...v0.2.0

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

[0.1.0]: https://github.com/srivtx/booklens/releases/tag/v0.1.0
