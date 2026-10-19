# Security policy

## Supported versions

Only the latest minor release receives security fixes.

## Reporting a vulnerability

Please do not open public issues for security problems. Use GitHub's private vulnerability
reporting on this repository (Security → Report a vulnerability). You will get an acknowledgement
within 7 days.

## Secrets handling

agent-evaluator never stores API keys. Keys are read from environment variables at runtime and the
HTTP API only reports whether a provider is configured. See the README section "Secrets" for the
recommended vault-based workflows.

## Run artifacts

`runs/<id>/` contains everything the simulated user saw and did: screenshots, accessibility
snapshots, typed text (`steps/NNN/action.json`), downloaded files and the console log. When a
target uses `auth.credentials_env`, the login pass types those values into the page and they can
appear in turn-0 evidence. Treat the runs directory as sensitive, keep it out of version control
(it is git-ignored by default) and prefer `auth.storage_state` captured outside the tool.

## Server exposure

`agent-evaluator serve` binds to `127.0.0.1` by default, has no authentication and can start browser
runs and edit workspace files. Do not expose it on a network interface without a reverse proxy that
adds authentication.
