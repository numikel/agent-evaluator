import type { WorkspaceOverview } from "@schemas/api";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { endpoints } from "../api/client.js";
import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";

type Load =
	| { status: "loading" }
	| { status: "ready"; data: WorkspaceOverview }
	| { status: "error"; message: string };

const TILES = [
	{ key: "scenarios", label: "Scenarios", to: "/scenarios" },
	{ key: "personas", label: "Personas", to: "/personas" },
	{ key: "rubrics", label: "Rubrics", to: "/rubrics" },
	{ key: "targets", label: "Targets", to: "/targets" },
] as const;

/** Workspace overview: proves the client → API → page path end to end; P12 adds recent runs. */
export function DashboardPage() {
	const [load, setLoad] = useState<Load>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		endpoints
			.workspace()
			.then((data) => {
				if (!cancelled) setLoad({ status: "ready", data });
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setLoad({
						status: "error",
						message: error instanceof Error ? error.message : String(error),
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div data-testid="page-dashboard">
			<PageHeader
				title="Dashboard"
				lead={
					load.status === "ready" ? (
						<>
							Workspace <code className="mono">{load.data.root}</code>
						</>
					) : (
						"Your evaluation workspace at a glance."
					)
				}
			/>
			<Panel title="Workspace">
				{load.status === "error" ? (
					<p className="inline-error" role="alert">
						Could not load the workspace: {load.message}
					</p>
				) : (
					<div className="stat-grid">
						{TILES.map((tile) => (
							<Link key={tile.key} className="stat" to={tile.to}>
								<span className="stat__value" data-testid={`workspace-count-${tile.key}`}>
									{load.status === "ready" ? load.data[tile.key].length : "–"}
								</span>
								<span className="stat__label">{tile.label}</span>
							</Link>
						))}
					</div>
				)}
			</Panel>
		</div>
	);
}
