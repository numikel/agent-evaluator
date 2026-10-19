### Added
- UI application shell (`ui/`): design tokens with light/dark themes, reduced-motion support and a visible focus ring; sidebar layout that collapses to a top strip below 760 px; skip link.
- Client-side routes for dashboard, personas, scenarios, rubrics, targets, evaluator, settings, runs and run detail, with page stubs and a root error boundary.
- Typed API client (`api.get/put/post/del` + route-typed `endpoints`) mapping 422 bodies to `ApiValidationError` and other failures to `ApiError`; `subscribeRunEvents` SSE helper validating events with `RunEventSchema`.
- Reusable components: `Button`, `Field`, `Panel`, `PageHeader`, `StatusBadge`, `ScoreGauge` (accessible meter).
- msw mock API for the `ui` Vitest project covering every documented `/api` route, with fixtures built from the shipped templates.
