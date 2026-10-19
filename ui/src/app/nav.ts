/** Sidebar entries in display order. `end` keeps "/" from matching every route. */
export type NavItem = { to: string; label: string; end?: boolean };

export const NAV_ITEMS: readonly NavItem[] = [
	{ to: "/", label: "Dashboard", end: true },
	{ to: "/runs", label: "Runs" },
	{ to: "/scenarios", label: "Scenarios" },
	{ to: "/personas", label: "Personas" },
	{ to: "/rubrics", label: "Rubrics" },
	{ to: "/targets", label: "Targets" },
	{ to: "/evaluator", label: "Evaluator" },
	{ to: "/settings", label: "Settings" },
];
