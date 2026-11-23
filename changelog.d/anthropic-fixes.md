### Fixed
- Runs on `anthropic:` models no longer fail before the first request with "Streaming is required for operations that may take longer than 10 minutes". The output limit defaults to the model profile's maximum (64k–128k tokens), which the Anthropic SDK refuses to wait for in a single response; Anthropic models are now always called in streaming mode, with the full output limit. This affected every Anthropic run, including the default `anthropic:claude-sonnet-5-5`.
- `effort.<role>` works on Claude Opus 4.7/4.8 and the Claude 5 family (`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-2`, …). These models accept only adaptive thinking, so they now get `thinking: { type: "adaptive" }` with `outputConfig.effort` at the same level instead of a thinking budget, which was rejected before the request was sent. Other Claude models keep the budget.
- A verdict the judge model refuses to give now fails the run with "Model refused to produce the requested output" instead of "No parseable tool calls provided to AnthropicToolsOutputParser".

### Added
- `validate` and the run's event log warn when `temperature.<role>` is set for an `anthropic:` model, which does not receive it (since 0.1.3); the settings page says so under Temperature.
- The release workflow creates a GitHub Release with the version's `CHANGELOG.md` section as notes (`github-release.yml`, which can also be run by hand for an existing tag).

### Changed
- Releases publish to npm through Trusted Publishing (OIDC) instead of an npm token, so there is no staged version to approve.
- LangChain: `@langchain/anthropic` 1.6.5 and `@langchain/core` 1.4.2 (now the minimum versions in `package.json`; the streaming fix needs them), `@langchain/langgraph` 1.7.5, `@langchain/openai` 1.8.4, `@langchain/xai` 1.5.6, `@langchain/openrouter` 0.4.25, `langchain` 1.6.7.
