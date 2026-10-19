/**
 * Run history: a filterable table (scenario / status from the query string, so links such as
 * `/runs?scenario=x` work) and the "Run scenario" launcher (`/runs?launch=1` opens it).
 */

import type { RunStatus, RunSummary } from "@schemas/run";
import { RunStatusSchema } from "@schemas/run";
import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { endpoints } from "../api/client.js";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";
import { ScoreGauge } from "../components/ScoreGauge.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { useAsync } from "../hooks/useAsync.js";
import { RunLauncher } from "../runs/RunLauncher.js";
import { formatDateTime, formatDuration, recentRuns, runDurationMs } from "../runs/stats.js";

const STATUSES: readonly RunStatus[] = RunStatusSchema.options;

export function RunsPage() {
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const [version, setVersion] = useState(0);
	const launchButton = useRef<HTMLButtonElement>(null);
	const list = useAsync(() => endpoints.runs(), `runs#${version}`);

	const scenarioFilter = params.get("scenario") ?? "";
	const statusParam = params.get("status") ?? "";
	const statusFilter = STATUSES.includes(statusParam as RunStatus) ? statusParam : "";
	const launching = params.get("launch") === "1";

	const setParam = (key: string, value: string) => {
		const next = new URLSearchParams(params);
		if (value === "") next.delete(key);
		else next.set(key, value);
		setParams(next, { replace: true });
	};
	const closeLauncher = () => {
		setParam("launch", "");
		launchButton.current?.focus();
	};

	const all: RunSummary[] = list.status === "ready" ? recentRuns(list.data, list.data.length) : [];
	const scenarios = [...new Set(all.map((r) => r.scenario))].sort();
	const rows = all.filter(
		(r) =>
			(scenarioFilter === "" || r.scenario === scenarioFilter) &&
			(statusFilter === "" || r.status === statusFilter),
	);

	return (
		<div data-testid="page-runs">
			<PageHeader
				title="Runs"
				lead="Every evaluation run with its status and score."
				actions={
					<>
						<Button onClick={() => setVersion((v) => v + 1)}>Refresh</Button>
						<Button
							ref={launchButton}
							variant="primary"
							aria-expanded={launching}
							onClick={() => setParam("launch", "1")}
						>
							Run scenario
						</Button>
					</>
				}
			/>
			{launching ? (
				<RunLauncher
					initialScenario={scenarioFilter}
					onClose={closeLauncher}
					onStarted={(runIds) => {
						const first = runIds[0];
						if (first) void navigate(`/runs/${encodeURIComponent(first)}`);
						else closeLauncher();
					}}
				/>
			) : null}
			<Panel
				title={`${rows.length} ${rows.length === 1 ? "run" : "runs"}`}
				actions={
					<div className="filters">
						<Field label="Scenario">
							{(control) => (
								<select
									{...control}
									aria-label="Filter by scenario"
									value={scenarioFilter}
									onChange={(e) => setParam("scenario", e.target.value)}
								>
									<option value="">All scenarios</option>
									{scenarios.map((s) => (
										<option key={s} value={s}>
											{s}
										</option>
									))}
									{scenarioFilter !== "" && !scenarios.includes(scenarioFilter) ? (
										<option value={scenarioFilter}>{scenarioFilter}</option>
									) : null}
								</select>
							)}
						</Field>
						<Field label="Status">
							{(control) => (
								<select
									{...control}
									aria-label="Filter by status"
									value={statusFilter}
									onChange={(e) => setParam("status", e.target.value)}
								>
									<option value="">All statuses</option>
									{STATUSES.map((s) => (
										<option key={s} value={s}>
											{s}
										</option>
									))}
								</select>
							)}
						</Field>
					</div>
				}
			>
				{list.status === "error" ? (
					<p className="inline-error" role="alert">
						Could not load runs: {list.message}
					</p>
				) : list.status === "loading" ? (
					<p className="muted">Loading…</p>
				) : all.length === 0 ? (
					<p className="muted">No runs yet. Start one with "Run scenario".</p>
				) : rows.length === 0 ? (
					<p className="muted">No runs match the current filters.</p>
				) : (
					<div className="table-wrap">
						<table className="table runs">
							<thead>
								<tr>
									<th scope="col">Scenario</th>
									<th scope="col">Persona</th>
									<th scope="col">Target</th>
									<th scope="col">Status</th>
									<th scope="col">Score</th>
									<th scope="col" className="num">
										Turns
									</th>
									<th scope="col">Started</th>
									<th scope="col">Duration</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((run) => (
									<tr key={run.id}>
										<th scope="row">
											<Link to={`/runs/${encodeURIComponent(run.id)}`}>{run.scenario}</Link>
											<span className="table__id mono">
												{run.id}
												{run.repeat_total > 1 ? ` (${run.repeat_index}/${run.repeat_total})` : ""}
											</span>
										</th>
										<td className="mono">{run.persona}</td>
										<td className="mono">{run.target}</td>
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
										<td className="num">
											{run.turns_used}/{run.max_turns}
										</td>
										<td className="table__time">
											<time dateTime={run.started_at}>{formatDateTime(run.started_at)}</time>
										</td>
										<td className="table__time">
											{formatDuration(runDurationMs(run.started_at, run.finished_at))}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Panel>
		</div>
	);
}
