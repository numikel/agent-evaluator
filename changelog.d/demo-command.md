### Added
- `agent-evaluator demo [--port] [--mode]` starts the built-in demo chatbot from the npm package, so the quick start no longer needs a clone of the repository; the chat page ships in the package.
- `agent-evaluator doctor` probes every target URL and reports whether it is reachable (informational).

### Changed
- A run whose target cannot be reached (`ERR_CONNECTION_REFUSED`, `ERR_NAME_NOT_RESOLVED`, …) now fails with an actionable message naming the target file and, for the demo, the `agent-evaluator demo` command.
