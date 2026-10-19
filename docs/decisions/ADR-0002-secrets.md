# ADR-0002: Secrets come from the environment only

Date: 2026-10-19 · Status: accepted

## Context

The user explicitly asked for a design without plaintext key files. The tool is run by developers
locally and in CI.

## Decision

- The only secret source is `process.env`, behind the `SecretsProvider` interface (`src/config/types.ts`).
- The tool never writes keys to disk. Settings files hold `provider:model` references only.
- The HTTP API exposes provider *presence* (`configured: true/false`), never values.
- Documented workflows: dotenvx (encrypted `.env`), 1Password CLI `op run`, direnv + sops, CI secrets.
  A plain `.env` is tolerated for local experiments and git-ignored.
- `agent-evaluator doctor` reports which providers are configured and whether Chromium is installed.

## Consequences

- Vault integration is the user's choice of wrapper command; no vault SDKs in the dependency tree.
- An OS-keychain `SecretsProvider` can be added later without touching consumers.
