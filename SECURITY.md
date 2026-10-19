# Security policy

Smartvie PM handles financial records and personal data, so please report vulnerabilities privately.

## Reporting

Use GitHub's **private vulnerability reporting** (the repository's *Security* tab, then *Report a vulnerability*). Please do not open a public issue or pull request for a security problem.

Include what you found, how to reproduce it, and the version or commit you tested. You can expect an acknowledgement within a few working days. The project is maintained by a small team, so fixes are made on a best-effort basis; we will credit you in the fix unless you prefer otherwise.

## Scope

In scope: the application code in this repository, its Docker image and the deployment and backup scripts under `deploy/`.

Out of scope: a deployment's own infrastructure and configuration (reverse proxy, firewall, secrets handling), denial of service by sheer volume, and findings that need an already-compromised administrator account.

## Supported versions

No release has been tagged yet; only the latest commit on `main` is supported.

## Deploying safely

Operational guidance is in [`docs/security/`](docs/security): backups, database roles and resetting two-factor sign-in. Never commit `.env`, keys or real company data.
