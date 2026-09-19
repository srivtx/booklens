# Contributing to booklens

Thanks for helping improve EPUB accessibility tooling. This document covers
what you need to build, test, and submit a change.

## Development setup

booklens targets [Bun](https://bun.sh) and TypeScript in strict mode.

```bash
git clone https://github.com/srivtx/booklens.git
cd booklens
bun install
```

Run the CLI from source while you work:

```bash
bun run src/cli.ts audit fixtures/inaccessible.epub
```

## The gate

Every pull request must pass the same gate CI runs:

```bash
bunx tsc --noEmit && bun test
```

Do not open a PR with a red typecheck or a failing test. Fix the cause rather
than disabling a rule or test.

## Fixtures

`fixtures/` holds the EPUBs the tests run against. They are generated, not
hand-edited:

```bash
bun run make-fixtures
```

`fixtures/good.epub` is a clean book and `fixtures/inaccessible.epub` is
intentionally broken. When you add a rule, add a fixture that exercises it and
assert on the emitted issue codes in `tests/rules.test.ts`. Fixer changes belong
in `tests/fix.test.ts` and must confirm the repaired book re-audits clean.

## Code style

- Strict TypeScript. No `any` to silence a type error, no non-null assertions
  to dodge null checks.
- No new runtime dependencies without discussion in an issue first. The offline
  and dependency-light posture is a feature.
- No network access, ever. Parsing and fixing are local operations.
- Match the surrounding style; keep modules small and focused.
- No comments unless they explain something non-obvious.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <summary>

fix(rules): flag missing page-list navigation
feat(fix): add --only filter for targeted repairs
test(zip): cover truncated archive members
docs: describe the audit output format
```

Common types: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`. Useful scopes:
`rules`, `fix`, `zip`, `cli`, `meta`.

## Pull request checklist

- [ ] Tests added or updated for the change.
- [ ] `bunx tsc --noEmit` is clean.
- [ ] `bun test` passes.
- [ ] Docs (`README.md`) updated when behavior or flags change.
- [ ] Commit messages follow Conventional Commits.
