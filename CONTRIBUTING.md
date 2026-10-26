# Contributing

Thanks for your interest in Smartvie PM. By contributing you agree that your work is released under the project's licence, the [AGPL-3.0](LICENSE).

## Setup

You need Node.js 22+, Yarn 4 (via Corepack) and PostgreSQL. See the README's *Getting started*.

## Before opening a pull request

```bash
yarn verify      # tsc, lint, unit tests
yarn test:db     # database rules and ledger services on a throwaway PostgreSQL (needs initdb/psql on PATH)
```

There is no CI: run these yourself before merging. `yarn hooks:install` makes `git push` run `yarn verify` first (skip once with `--no-verify`). Run `yarn test:db` whenever you touch a migration or anything under `src/lib/accounting/`. `yarn test:coverage` reports coverage for `src/lib` and `src/hermes`, and fails below the floor in `vitest.config.ts`; raise the floor as it improves.

Set `E2E_STRICT=1` when running `yarn test:e2e` to make missing credentials fail instead of skipping.

## Ground rules

- **Money is integer pence.** Use the helpers in `src/lib/money.ts`; never do float arithmetic on ledger amounts.
- **The ledger has one writer.** Only `src/lib/accounting/posting.ts` writes journals, and posted entries are immutable. Corrections are reversals.
- **Every API route authenticates and authorises.** A route test fails if one does not.
- **Schema changes go in migrations**, never in application code.
- **No private data.** Do not commit real names, emails, hosts, credentials or company details; use `example.com` and placeholders in docs, fixtures and tests.
- Keep changes focused, and add or update tests for behaviour you change.

## Reporting bugs and vulnerabilities

Bugs: open an issue with steps to reproduce. Security problems: follow [`SECURITY.md`](SECURITY.md) instead.

## Releasing

1. Add an entry at the top of `RELEASES` in `src/lib/releases.ts` (plain-language highlights) and commit it to `main`.
2. `yarn release x.y.z` bumps `package.json`, commits and tags `vx.y.z`.
3. `git push && git push --tags`. Nothing is published automatically; optionally create a GitHub release from the tag with `gh release create vx.y.z --generate-notes`.
4. Deploy with `./deploy.sh`, which builds the image from source on the server.

Signed-in users see a "What's new" notice once after the upgrade, and a "Refresh to update" prompt on pages left open across it.
