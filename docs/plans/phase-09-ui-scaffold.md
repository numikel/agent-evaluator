# Phase 9 — UI scaffold

Depends on: P0 only (API contract from `src/schemas/api.ts`; msw mocks). Wave 1 `[PARALLEL]`.
Commit: `feat(ui): React application shell, routing, typed API client and mocks`

## Goal
Replace the placeholder in `ui/` with the application shell: layout, navigation, typed API client,
msw-based mock API for tests, and empty pages that P12a/P12b fill in.

## Read first
`ui/` (placeholder), `src/schemas/api.ts`, `vitest.config.ts` (project `ui`, jsdom, `ui/src/test-setup.ts`),
`docs/plans/README.md` → reference skills *frontend-design* (plan a token system first; one bold element;
responsive, focus states, reduced motion), *react-best-practices* (no barrel imports, `Promise.all`, derive state in render),
*web-design-guidelines*. React 19.3, react-router 8.5 (data routers), Vite 8.

## Deliverables
- `ui/src/theme.css` — design tokens: 4–6 named colours (light + dark via `prefers-color-scheme`), two type roles (UI sans + mono for refs/ids), spacing scale, focus ring. Write the token plan in a comment header before coding (frontend-design process).
- `ui/src/api/client.ts` — `api.get/put/post` with `fetch`, JSON, typed by DTOs imported from `@schemas/api` (`import type`), error mapping (`ValidationErrorBody` → `ApiValidationError`). `ui/src/api/sse.ts` — `subscribeRunEvents(runId, onEvent)` using `EventSource`, parsing with `RunEventSchema`.
- `ui/src/app/routes.tsx` — routes: `/` (dashboard), `/personas`, `/personas/:name`, `/scenarios[/:name]`, `/rubrics[/:name]`, `/targets[/:name]`, `/evaluator`, `/settings`, `/runs`, `/runs/:id`. `ui/src/app/Layout.tsx` — sidebar nav + content; `ui/src/pages/*` stubs rendering the route name and a `data-testid`.
- `ui/src/components/` — `Button`, `Field`, `StatusBadge` (PASSED/FAILED/ERROR/RUNNING), `ScoreGauge` (percentage ring, accessible text), `Panel`.
- `ui/src/mocks/handlers.ts` + `server.ts` (msw/node) covering every route in `api.ts` with fixture data (import templates via `?raw`), used by tests through `test-setup.ts` (`beforeAll(server.listen)`).
- `ui/src/main.tsx` wires router + theme. Tests: `ui/src/app/routes.test.tsx` (navigation renders each page), `ui/src/api/client.test.ts` (422 mapping), `ui/src/components/ScoreGauge.test.tsx` (renders `87%`, aria-label).
- `changelog.d/phase-09-ui-scaffold.md`.

## Seams & TDD slices
1. `ScoreGauge({score: 0.874})` renders text `87%` and `role="meter"` with `aria-valuenow=87`.
2. `api.get("/api/scenarios")` against msw returns typed data; a 422 rejects with `ApiValidationError.issues`.
3. Routing: rendering `/runs` shows the runs page stub; nav links have `aria-current` on the active route.
4. `subscribeRunEvents` parses a mocked `EventSource` message into a `RunEvent` and ignores malformed lines.

## Commands
`npm test -- ui` · `npm run typecheck` · `npm run build` (Vite output in `dist/ui`)

## Definition of done
- [ ] `npm run build` produces `dist/ui`; app renders in the browser via `vite --config ui/vite.config.ts` with msw disabled.
- [ ] Keyboard navigable; focus visible; reduced-motion respected; no horizontal scroll at 360 px.
- [ ] No new dependencies. Changelog fragment. `npm run verify` green.
