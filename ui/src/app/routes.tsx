import { createBrowserRouter, type RouteObject } from "react-router";
import { DashboardPage } from "../pages/DashboardPage.js";
import { NotFoundPage } from "../pages/NotFoundPage.js";
import { Layout } from "./Layout.js";
import { RouteError } from "./RouteError.js";

/**
 * Route map (all rendered inside {@link Layout}):
 *   /                       DashboardPage
 *   /personas[/:name]       PersonasPage
 *   /scenarios[/:name]      ScenariosPage
 *   /rubrics[/:name]        RubricsPage
 *   /targets[/:name]        TargetsPage
 *   /evaluator              EvaluatorPage
 *   /settings               SettingsPage
 *   /runs                   RunsPage
 *   /runs/:id               RunDetailPage
 *   *                       NotFoundPage
 *
 * The editors and the run pages are route-level code-split (`lazy`), so the dashboard shell
 * ships without the YAML editors or the live-run machinery; the dashboard itself stays eager.
 */
const lazyPage =
	<K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
	async () => ({ Component: (await load())[name] });

const personas = lazyPage(() => import("../pages/PersonasPage.js"), "PersonasPage");
const scenarios = lazyPage(() => import("../pages/ScenariosPage.js"), "ScenariosPage");
const rubrics = lazyPage(() => import("../pages/RubricsPage.js"), "RubricsPage");
const targets = lazyPage(() => import("../pages/TargetsPage.js"), "TargetsPage");
const evaluator = lazyPage(() => import("../pages/EvaluatorPage.js"), "EvaluatorPage");
const settings = lazyPage(() => import("../pages/SettingsPage.js"), "SettingsPage");
const runs = lazyPage(() => import("../pages/RunsPage.js"), "RunsPage");
const runDetail = lazyPage(() => import("../pages/RunDetailPage.js"), "RunDetailPage");

/** Shown while a lazy route's chunk loads on the first navigation; keeps the shell quiet. */
function HydrateFallback() {
	return (
		<main className="content" tabIndex={-1}>
			<p className="muted">Loading…</p>
		</main>
	);
}

export const routes: RouteObject[] = [
	{
		path: "/",
		Component: Layout,
		HydrateFallback,
		ErrorBoundary: RouteError,
		children: [
			{ index: true, Component: DashboardPage },
			{ path: "personas", lazy: personas },
			{ path: "personas/:name", lazy: personas },
			{ path: "scenarios", lazy: scenarios },
			{ path: "scenarios/:name", lazy: scenarios },
			{ path: "rubrics", lazy: rubrics },
			{ path: "rubrics/:name", lazy: rubrics },
			{ path: "targets", lazy: targets },
			{ path: "targets/:name", lazy: targets },
			{ path: "evaluator", lazy: evaluator },
			{ path: "settings", lazy: settings },
			{ path: "runs", lazy: runs },
			{ path: "runs/:id", lazy: runDetail },
			{ path: "*", Component: NotFoundPage },
		],
	},
];

export function createAppRouter() {
	return createBrowserRouter(routes);
}
