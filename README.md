# Smartvie PM

A self-hosted web application for running a small organisation's projects **and** its money in one place: plan the work, track what funds it, and keep the company's books.

Most small teams juggle a task tracker, a funding spreadsheet and a separate accounting tool, and the three never quite agree. Smartvie PM keeps them in a single system so that spend recorded against a task, a funding award and an invoice are the same numbers everywhere.

> **Status: under active development.** It is used in production by its authors but is not yet packaged for general use. Expect rough edges, breaking changes and gaps in the documentation. No release has been tagged.

## What it does

**Project management**
- Projects, phases, milestones and tasks, with owners, dates, priorities and progress
- Gantt timeline, sortable tables and drag-and-drop ordering
- Resources and people, assignments and custom fields
- Pilot / test-site tracking ("living labs") with their own costs

**Funding**
- Grants, loans, investment and other income as a pipeline (with a kanban view): stages, probabilities, deadlines and next actions
- Instalments (tranches) that are scheduled, received or repaid
- Cash position, runway and a month-by-month cash-flow projection
- Budget versus actual by phase, milestone, cost category or task

**Books** (company-level double-entry accounting)
- General ledger with a chart of accounts, gapless journal numbering and a lock date
- Sales invoices, credit notes and customer payments, with PDF output
- Contacts and a product / service catalogue
- Bank statement import (CSV) and reconciliation
- Balance sheet, aged debtors and other reports, exportable as CSV or PDF
- Posted entries are immutable; corrections are made by reversal, never by editing

**For AI assistants**
- An [MCP](https://modelcontextprotocol.io) server (about 60 tools) exposes the same data to an AI agent, over HTTP or stdio, authenticated with a bearer token

## Security approach

The security model is part of the design rather than an afterthought. In brief:

- Password rules, sign-in throttling and revocable sessions
- Optional or enforced two-factor sign-in (TOTP) by role, with recovery codes and a fresh second-factor check before rare, high-risk actions
- An append-only audit trail of financial changes, user changes and sign-ins
- Sensitive values (authenticator secrets, bank account numbers) encrypted at rest, with key rotation
- Role- and capability-based authorisation, enforced and tested on every API route
- Security alerts to a webhook, optional second-approver control, and encrypted, verified database backups


## Tech stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · Prisma · PostgreSQL · NextAuth (Auth.js) · Radix UI / shadcn-style components · Recharts · TanStack Table · dnd-kit · React Hook Form + Zod · Vitest · Playwright · Docker

## Getting started

You need **Node.js 22+**, **Yarn 4** (via Corepack) and a **PostgreSQL** database.

```bash
git clone <repository-url>
cd SMV-PM
corepack enable
yarn install

cp .env.example .env        # then edit it (see below)
npx prisma migrate deploy   # create the database schema
yarn dev                    # http://localhost:3000
```

### Configuration

Set at least these in `.env`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (in production, a least-privilege role that can only read and write rows) |
| `MIGRATION_DATABASE_URL` | Optional: the schema owner, used only to run migrations at start-up. See [`docs/security/DB-ROLES.md`](docs/security/DB-ROLES.md) |
| `AUTH_SECRET` | Session signing secret: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | The URL the app is served from |
| `DATA_ENCRYPTION_KEYS` | Field-encryption keys as `id:base64key`; the first is current. Generate with `openssl rand -base64 32`. **Back these up** — encrypted values cannot be read without them |
| `HERMES_API_TOKEN` | Bearer token for the AI-agent endpoint (only if you use it) |

Optional settings include `MFA_REQUIRED_ROLES` (which roles must use two-factor; Admin and PM by default), `TRUSTED_PROXY_IPS` (the reverse proxy whose forwarded client address is believed) and `SECURITY_ALERT_WEBHOOK_URL` (where security alerts are sent). `.env.example` lists them with comments.

For local development only, set `MFA_REQUIRED_ROLES=none` so you can sign in before enrolling an authenticator.

### First user

There is no sign-up page. Create the first administrator once, with credentials of your choosing. They are read from the environment, checked against the password policy, and never printed or stored in the repository:

```bash
ADMIN_EMAIL=you@example.com \
ADMIN_NAME="Your Name" \
ADMIN_PASSWORD='a long passphrase you will change' \
npx tsx scripts/seed-admin.ts
```

The password is treated as temporary: you are asked to replace it at first sign-in. The script prints which database it is about to use, and does nothing if an administrator already exists.

## Development

```bash
yarn dev          # development server
yarn lint         # ESLint
yarn test         # unit tests (Vitest)
yarn build        # production build (standalone output)
yarn hermes       # the AI-agent server over stdio, for local debugging
```

Some accounting rules are enforced twice, in code and by database constraints and triggers in the migrations, so that nothing — a script, an agent, a SQL session — can bypass them.

## Deployment

The app builds to a self-contained Next.js server and ships as a Docker image. `docker-compose.yml` runs the app with a PostgreSQL container; the entrypoint applies database migrations on start. Put it behind a reverse proxy that terminates TLS. A sample backup setup (encrypted, verified, space-limited) is in [`deploy/backup`](deploy/backup), with its runbook in [`docs/security/BACKUPS.md`](docs/security/BACKUPS.md).

## Project layout

```
src/app/         pages and API routes (Next.js App Router)
src/components/  UI components
src/lib/         domain logic: accounting, funding, auth, MFA, audit, crypto
src/hermes/      the MCP server for AI agents
prisma/          schema, migrations and database checks
docs/security/   operational runbooks (backups, resetting two-factor)
deploy/          backup and deployment helpers
```

## Planned

- Accounting: opening balances, supplier bills and payments, VAT returns and further financial statements
- Security hardening: least-privilege database roles, a tamper-evident audit log, scoped API tokens and a content security policy

## Contributing and licence

Smartvie PM is free software under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, the AGPL requires you to offer its users the source of your changes.

Contributions are welcome: see [`CONTRIBUTING.md`](CONTRIBUTING.md). To report a vulnerability, follow [`SECURITY.md`](SECURITY.md) rather than opening a public issue.
