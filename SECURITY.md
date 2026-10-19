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
