import { createBrowserRouter, type RouteObject } from "react-router";
import { DashboardPage } from "../pages/DashboardPage.js";
import { EvaluatorPage } from "../pages/EvaluatorPage.js";
import { NotFoundPage } from "../pages/NotFoundPage.js";
import { PersonasPage } from "../pages/PersonasPage.js";
import { RubricsPage } from "../pages/RubricsPage.js";
import { RunDetailPage } from "../pages/RunDetailPage.js";
import { RunsPage } from "../pages/RunsPage.js";
import { ScenariosPage } from "../pages/ScenariosPage.js";
import { SettingsPage } from "../pages/SettingsPage.js";
import { TargetsPage } from "../pages/TargetsPage.js";
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
 */
export const routes: RouteObject[] = [
	{
		path: "/",
		Component: Layout,
		ErrorBoundary: RouteError,
		children: [
			{ index: true, Component: DashboardPage },
			{ path: "personas", Component: PersonasPage },
			{ path: "personas/:name", Component: PersonasPage },
			{ path: "scenarios", Component: ScenariosPage },
			{ path: "scenarios/:name", Component: ScenariosPage },
			{ path: "rubrics", Component: RubricsPage },
			{ path: "rubrics/:name", Component: RubricsPage },
			{ path: "targets", Component: TargetsPage },
			{ path: "targets/:name", Component: TargetsPage },
			{ path: "evaluator", Component: EvaluatorPage },
			{ path: "settings", Component: SettingsPage },
			{ path: "runs", Component: RunsPage },
			{ path: "runs/:id", Component: RunDetailPage },
			{ path: "*", Component: NotFoundPage },
		],
	},
];

export function createAppRouter() {
	return createBrowserRouter(routes);
}
