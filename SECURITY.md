# Security Policy

## booklens

booklens audits EPUB accessibility and can write a corrected EPUB. It reads an
untrusted archive, parses the package document and content documents, reports
failures, and optionally emits a repaired copy.

## Supported versions

The latest commit on `main` is the only supported version. Security fixes land
on `main` and ship in the next tagged release. Older tags do not receive
backports.

| Version | Supported |
| --- | --- |
| Latest on `main` | Yes |
| Older tags | No |

## Threat model

- **Offline by design.** booklens contains no network code. It never opens a
  socket, fetches remote resources referenced by a book, or checks for updates.
- **No telemetry.** Nothing about your documents, your usage, or your machine
  is collected or transmitted.
- **Documents never leave the machine.** Parsing, auditing, and fixing all run
  in-process and locally.
- **Untrusted input.** An EPUB is treated as hostile: ZIP members and XML are
  parsed defensively. Member names are canonicalized and any absolute or `..`
  path is rejected on read, and no member name that escapes the archive root is
  ever written. A malformed, deeply nested, or oversized archive fails safely
  rather than escape the output path or exhaust the process.
- **Bounded decompression.** `readEpub` checks the sizes declared in the ZIP
  central directory before allocating any member and refuses an archive with
  more than 65,535 members, a member that expands beyond 512 MiB, or more than
  1 GiB uncompressed in total (`DEFAULT_UNZIP_LIMITS` in `src/zip.ts`). A small
  archive that declares a huge member is rejected with `EpubReadError`, not
  expanded.
- **No code execution from input.** Embedded scripts, macros, and remote
  content in a book are never evaluated or resolved.
- **Fixers are conservative.** A repair rewrites only the accessibility
  metadata and markup it understands; it must not silently drop content.

## Reporting a vulnerability

Report privately through GitHub Security Advisories on the repository:

https://github.com/srivtx/booklens/security/advisories/new

Do not open a public issue for a suspected vulnerability. Include a
description, the affected revision, a minimal reproducer (an EPUB fixture
where possible), and any suggested fix. Expect an acknowledgement within a
few days.

## Verifying a build

```bash
bun install
bunx tsc --noEmit
bun test
```

This installs the locked dependency set, typechecks in strict mode, and runs
the test suite against the generated fixtures. In CI the same gate runs on
every push and pull request.
