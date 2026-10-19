# Phase 12a — UI: editors, settings, templates

Depends on: P8 P9 (Wave 2, `[PARALLEL]` with P10). Commit: `feat(ui): persona, scenario, rubric, target and evaluator editors with settings page`

## Goal
Visual configuration: edit every workspace file with validation feedback, choose models per role from
live provider lists, download/upload templates.

## Read first
`src/schemas/api.ts`, `ui/src` (P9 shell, components, msw mocks), reference skills *frontend-design*, *react-best-practices*, *web-design-guidelines* (run its review before finishing).

## Deliverables
- Resource list pages (`/personas`, `/scenarios`, `/rubrics`, `/targets`): table with name/description/updated, "New from template", delete with confirm.
- Editors: split view **form ⇄ raw text** kept in sync (persona: frontmatter form + Markdown textarea with section hints; scenario: form fields for goal/intent/success_criteria/max_turns/examples/expected_artifacts + YAML tab; rubric: criteria list editor with type-specific fields and live weighted-score preview; target: url/hints/timeouts/auth form; evaluator: principles textarea + max_images + default rubric select). Validation on blur via `POST /api/validate`; issues shown inline next to the path; save via `PUT`.
- Settings page: for each role (`simulator`, `judge`, `evidence_selector`) a cascade **provider → model → effort**: providers from `GET /api/providers` (configured only; empty state explains env vars + vault options and links to README "Secrets"); models from `GET /api/providers/:id/models` with a refresh button and a `fallback` notice; model card shows context window / max output / image & reasoning support when known; effort select (`none/low/medium/high/max`) with a hint that it maps to the provider's own knob; temperature optional; browser headless + concurrency + runs dir. Saves to `PUT /api/settings`. Shows `browser_installed` warning with the install command.
- Templates: "Download template" buttons (`GET /api/templates/:kind`), "Upload file" (reads file → validate → PUT).
- Tests (jsdom + msw): persona form edits propagate to raw text and back; invalid scenario shows the issue path; settings cascade only shows configured providers and loads models on provider change; effort saved in settings PUT body; template download link has `download` attribute.
- `changelog.d/phase-12a-ui-editors.md`.

## Definition of done
- [ ] All editors save round-trip against the real server (`npm run dev` + `vite` with proxy) — manual check noted in the commit body.
- [ ] Web-interface-guidelines review done; keyboard-only flow works; 360 px layout ok.
- [ ] No new dependencies. Changelog fragment. `npm run verify` green.
