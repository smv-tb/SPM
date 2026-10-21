# Contributing

Thanks for your interest in Smartvie PM. By contributing you agree that your work is released under the project's licence, the [AGPL-3.0](LICENSE).

## Setup

You need Node.js 22+, Yarn 4 (via Corepack) and PostgreSQL. See the README's *Getting started*.

## Before opening a pull request

```bash
yarn lint
yarn tsc --noEmit
yarn test --run
```

CI runs the same checks plus a dependency audit and a secret scan.

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
3. `git push && git push --tags`. The *Release* workflow publishes `ghcr.io/smv-tb/spm:x.y.z` (also `x.y` and `latest`) and a GitHub release.
4. Deploy with `./deploy.sh` (build from source) or `docker compose pull app && docker compose up -d`.

Signed-in users see a "What's new" notice once after the upgrade, and a "Refresh to update" prompt on pages left open across it.
