/**
 * Workspace at a glance: resource counts, quick links, the last ten runs and the pass rate per
 * scenario (derived client-side from `GET /api/runs`).
 */
import { Link } from "react-router";
import { endpoints } from "../api/client.js";
import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";
import { ScoreGauge } from "../components/ScoreGauge.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { useAsync } from "../hooks/useAsync.js";
import { formatDateTime, passRateByScenario, recentRuns } from "../runs/stats.js";

const TILES = [
	{ key: "scenarios", label: "Scenarios", to: "/scenarios" },
	{ key: "personas", label: "Personas", to: "/personas" },
	{ key: "rubrics", label: "Rubrics", to: "/rubrics" },
	{ key: "targets", label: "Targets", to: "/targets" },
] as const;

const QUICK_LINKS = [
	{ to: "/runs?launch=1", label: "Run a scenario", primary: true },
	{ to: "/runs", label: "All runs" },
	{ to: "/scenarios", label: "Edit scenarios" },
	{ to: "/settings", label: "Settings" },
] as const;

const RECENT = 10;

export function DashboardPage() {
	const load = useAsync(() => Promise.all([endpoints.workspace(), endpoints.runs()]), "dashboard");
	const workspace = load.status === "ready" ? load.data[0] : undefined;
	const runs = load.status === "ready" ? load.data[1] : [];
	const recent = recentRuns(runs, RECENT);
	const rates = passRateByScenario(runs);

	return (
		<div data-testid="page-dashboard">
			<PageHeader
				title="Dashboard"
				lead={
					workspace ? (
						<>
							Workspace <code className="mono">{workspace.root}</code>
						</>
					) : (
						"Your evaluation workspace at a glance."
					)
				}
				actions={
					<nav className="quick-links" aria-label="Quick links">
						{QUICK_LINKS.map((link) => (
							<Link
								key={link.to}
								className={`btn${"primary" in link && link.primary ? " btn--primary" : ""}`}
								to={link.to}
							>
								{link.label}
							</Link>
						))}
					</nav>
				}
			/>
			{load.status === "error" ? (
				<p className="notice notice--error" role="alert">
					Could not load the dashboard: {load.message}
				</p>
			) : null}
			<Panel title="Workspace">
				<div className="stat-grid">
					{TILES.map((tile) => (
						<Link key={tile.key} className="stat" to={tile.to}>
							<span className="stat__value" data-testid={`workspace-count-${tile.key}`}>
								{workspace ? workspace[tile.key].length : "–"}
							</span>
							<span className="stat__label">{tile.label}</span>
						</Link>
					))}
				</div>
			</Panel>
			<div className="run-grid run-grid--dash">
				<Panel title="Recent runs">
					{load.status === "loading" ? (
						<p className="muted">Loading…</p>
					) : recent.length === 0 ? (
						<p className="muted">No runs yet. Start one from a scenario.</p>
					) : (
						<div className="table-wrap">
							<table className="table table--compact">
								<thead>
									<tr>
										<th scope="col">Run</th>
										<th scope="col">Scenario</th>
										<th scope="col">Status</th>
										<th scope="col">Score</th>
										<th scope="col">Started</th>
									</tr>
								</thead>
								<tbody>
									{recent.map((run) => (
										<tr key={run.id}>
											<th scope="row">
												<Link
													className="mono table__break"
													to={`/runs/${encodeURIComponent(run.id)}`}
												>
													{run.id}
												</Link>
											</th>
											<td className="mono">{run.scenario}</td>
											<td>
												<StatusBadge status={run.status} />
											</td>
											<td>
												{run.score === undefined ? (
													<span className="muted">—</span>
												) : (
													<ScoreGauge
														score={run.score}
														size="xs"
														status={
															run.status === "PASSED" || run.status === "FAILED"
																? run.status
																: undefined
														}
													/>
												)}
											</td>
											<td className="table__time">
												<time dateTime={run.started_at}>{formatDateTime(run.started_at)}</time>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Panel>
				<Panel title="Pass rate by scenario">
					{load.status === "loading" ? (
						<p className="muted">Loading…</p>
					) : rates.length === 0 ? (
						<p className="muted">Pass rates appear once scenarios have been run.</p>
					) : (
						<div className="table-wrap">
							<table className="table table--compact">
								<thead>
									<tr>
										<th scope="col">Scenario</th>
										<th scope="col" className="num">
											Runs
										</th>
										<th scope="col" className="num">
											Passed
										</th>
										<th scope="col" className="num">
											Failed
										</th>
										<th scope="col" className="num">
											Pass rate
										</th>
									</tr>
								</thead>
								<tbody>
									{rates.map((rate) => (
										<tr key={rate.scenario}>
											<th scope="row">
												<Link
													className="mono"
													to={`/runs?scenario=${encodeURIComponent(rate.scenario)}`}
												>
													{rate.scenario}
												</Link>
											</th>
											<td className="num">{rate.total}</td>
											<td className="num">{rate.passed}</td>
											<td className="num">{rate.failed}</td>
											<td className="num">
												{rate.rate === undefined ? (
													<span className="muted">—</span>
												) : (
													<span
														className="pass-rate"
														data-level={
															rate.rate >= 0.8 ? "good" : rate.rate >= 0.5 ? "mid" : "low"
														}
													>
														{Math.round(rate.rate * 100)}%
													</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Panel>
			</div>
		</div>
	);
}
