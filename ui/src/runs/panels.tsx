/** Presentational panels of the run detail page. Each takes plain data from the view state. */
import type {
	CriterionResult,
	DownloadArtifact,
	RunStatus,
	Step,
	TranscriptEntry,
	Verdict,
} from "@schemas/run";
import { endpoints } from "../api/client.js";
import { Button } from "../components/Button.js";
import { Panel } from "../components/Panel.js";
import { ScoreGauge } from "../components/ScoreGauge.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { useAsync } from "../hooks/useAsync.js";
import type { LogLine } from "./reducer.js";
import {
	describeAction,
	formatBytes,
	formatDateTime,
	formatDuration,
	formatLatency,
} from "./stats.js";
import type { ConnectionState } from "./useRunStream.js";

const percent = (score: number) => `${Math.round(score * 100)}%`;
const pad = (index: number) => String(index).padStart(3, "0");

/* ---------- overview ---------- */

export type RunOverviewProps = {
	status: RunStatus;
	turn: number;
	maxTurns: number | undefined;
	elapsedMs: number | undefined;
	startedAt: string | undefined;
	scenario: string | undefined;
	persona: string | undefined;
	target: string | undefined;
	repeat: { index: number; total: number } | undefined;
	connection: ConnectionState;
	cancellable: boolean;
	cancelling: boolean;
	onCancel(): void;
};

const CONNECTION_LABEL: Partial<Record<ConnectionState, string>> = {
	connecting: "Connecting…",
	reconnecting: "Reconnecting…",
	unsupported: "Live updates are not available in this browser; reload to refresh.",
};

export function RunOverview(props: RunOverviewProps) {
	const connectionLabel = CONNECTION_LABEL[props.connection];
	return (
		<section className="panel run-overview" aria-label="Run overview">
			<div className="run-overview__status">
				<StatusBadge status={props.status} label="Run status" />
				{connectionLabel ? (
					<span className="conn" role="status" data-state={props.connection}>
						{connectionLabel}
					</span>
				) : null}
				{props.connection === "open" ? (
					<span className="conn conn--live" aria-hidden="true">
						live
					</span>
				) : null}
			</div>
			<dl className="facts">
				<div>
					<dt>Turn</dt>
					<dd>
						{props.turn}/{props.maxTurns ?? "?"}
					</dd>
				</div>
				<div>
					<dt>Elapsed</dt>
					<dd>{formatDuration(props.elapsedMs)}</dd>
				</div>
				<div>
					<dt>Started</dt>
					<dd>
						<time dateTime={props.startedAt}>{formatDateTime(props.startedAt)}</time>
					</dd>
				</div>
				<div>
					<dt>Scenario</dt>
					<dd className="mono">
						{props.scenario ?? "—"}
						{props.repeat && props.repeat.total > 1 ? (
							<span className="tag">
								{props.repeat.index}/{props.repeat.total}
							</span>
						) : null}
					</dd>
				</div>
				<div>
					<dt>Persona</dt>
					<dd className="mono">{props.persona ?? "—"}</dd>
				</div>
				<div>
					<dt>Target</dt>
					<dd className="mono">{props.target ?? "—"}</dd>
				</div>
			</dl>
			{props.cancellable ? (
				<div className="run-overview__actions">
					<Button variant="danger" disabled={props.cancelling} onClick={props.onCancel}>
						{props.cancelling ? "Cancelling…" : "Cancel run"}
					</Button>
				</div>
			) : null}
		</section>
	);
}

/* ---------- evidence strip ---------- */

export type EvidenceStripProps = {
	runId: string;
	steps: readonly Step[];
	selected: number | undefined;
	onSelect(index: number): void;
};

export function EvidenceStrip({ runId, steps, selected, onSelect }: EvidenceStripProps) {
	return (
		<Panel title="Evidence" className="evidence">
			{steps.length === 0 ? (
				<p className="muted">No steps recorded yet.</p>
			) : (
				<ol className="strip" aria-label="Steps">
					{steps.map((step) => {
						const label = `Step ${step.index}: ${describeAction(step.action)}`;
						const active = selected === step.index;
						return (
							<li key={step.index} className="strip__item">
								<button
									type="button"
									className={`thumb${active ? " thumb--active" : ""}${step.error ? " thumb--error" : ""}`}
									aria-pressed={active}
									onClick={() => onSelect(step.index)}
								>
									{step.screenshot ? (
										<img
											src={endpoints.artifactUrl(runId, step.screenshot)}
											alt={label}
											loading="lazy"
											decoding="async"
											width={160}
											height={100}
										/>
									) : (
										<span className="thumb__blank" title={label}>
											no screenshot
										</span>
									)}
									<span className="thumb__label" aria-hidden="true">
										<span className="mono">{pad(step.index)}</span> {describeAction(step.action)}
									</span>
								</button>
							</li>
						);
					})}
				</ol>
			)}
		</Panel>
	);
}

/* ---------- step panel ---------- */

export type StepPanelProps = { runId: string; step: Step; onClose(): void };

function SnapshotText({ runId, path }: { runId: string; path: string }) {
	const text = useAsync((key) => endpoints.artifact(runId, key), path);
	if (text.status === "loading") return <p className="muted">Loading snapshot…</p>;
	if (text.status === "error") {
		return <p className="inline-error">Could not load the snapshot: {text.message}</p>;
	}
	return <pre className="snapshot">{text.data}</pre>;
}

export function StepPanel({ runId, step, onClose }: StepPanelProps) {
	const title = `Step ${step.index}`;
	return (
		<section className="panel step-panel" aria-label={`${title} details`}>
			<div className="panel__head">
				<h2 className="panel__title">
					{title} <span className="muted">{describeAction(step.action)}</span>
				</h2>
				<div className="panel__actions">
					<Button size="sm" onClick={onClose}>
						Close
					</Button>
				</div>
			</div>
			<div className="step-panel__body">
				<div className="step-panel__media">
					{step.screenshot ? (
						<a
							href={endpoints.artifactUrl(runId, step.screenshot)}
							target="_blank"
							rel="noopener noreferrer"
						>
							<img
								src={endpoints.artifactUrl(runId, step.screenshot)}
								alt={`${title} screenshot`}
								decoding="async"
							/>
						</a>
					) : (
						<p className="muted">This step has no screenshot.</p>
					)}
					{step.interim_screenshots.length > 0 ? (
						<p className="muted step-panel__interim">
							{step.interim_screenshots.length} interim capture
							{step.interim_screenshots.length === 1 ? "" : "s"} while waiting for the reply:{" "}
							{step.interim_screenshots.map((path, i) => (
								<a
									key={path}
									href={endpoints.artifactUrl(runId, path)}
									target="_blank"
									rel="noopener noreferrer"
								>
									#{i + 1}
								</a>
							))}
						</p>
					) : null}
				</div>
				<div className="step-panel__details">
					<dl className="facts facts--stack">
						<div>
							<dt>Turn</dt>
							<dd>{step.turn}</dd>
						</div>
						<div>
							<dt>Duration</dt>
							<dd>{formatDuration(step.duration_ms)}</dd>
						</div>
						{step.thought ? (
							<div>
								<dt>Thought</dt>
								<dd>{step.thought}</dd>
							</div>
						) : null}
						{step.result ? (
							<div>
								<dt>Result</dt>
								<dd className="pre-wrap">{step.result}</dd>
							</div>
						) : null}
						{step.error ? (
							<div>
								<dt>Error</dt>
								<dd className="inline-error pre-wrap">{step.error}</dd>
							</div>
						) : null}
					</dl>
					<h3 className="step-panel__sub">Action</h3>
					<pre className="code">{JSON.stringify(step.action, null, 2)}</pre>
					<h3 className="step-panel__sub">Accessibility snapshot</h3>
					{step.snapshot ? (
						<SnapshotText runId={runId} path={step.snapshot} />
					) : (
						<p className="muted">No snapshot was taken for this step.</p>
					)}
				</div>
			</div>
		</section>
	);
}

/* ---------- transcript ---------- */

export function TranscriptPanel({ entries }: { entries: readonly TranscriptEntry[] }) {
	return (
		<Panel title="Transcript" className="transcript-panel">
			{entries.length === 0 ? (
				<p className="muted">No messages yet.</p>
			) : (
				<ol className="transcript">
					{entries.map((entry) => (
						<li
							key={`${entry.turn}:${entry.role}:${entry.at}`}
							className={`bubble bubble--${entry.role}`}
						>
							<span className="bubble__meta">
								<span className="bubble__role">{entry.role === "user" ? "User" : "Bot"}</span>
								<span className="muted"> turn {entry.turn}</span>
								{entry.role === "bot" && entry.latency_ms !== undefined ? (
									<span className="bubble__latency" title="Reply latency">
										{formatLatency(entry.latency_ms)}
									</span>
								) : null}
							</span>
							<span className="bubble__text">{entry.text}</span>
						</li>
					))}
				</ol>
			)}
		</Panel>
	);
}

/* ---------- downloads ---------- */

export function DownloadsPanel({
	runId,
	downloads,
}: {
	runId: string;
	downloads: readonly DownloadArtifact[];
}) {
	return (
		<Panel title="Downloads">
			{downloads.length === 0 ? (
				<p className="muted">No files were downloaded.</p>
			) : (
				<ul className="downloads">
					{downloads.map((d) => (
						<li key={d.path}>
							<a href={endpoints.artifactUrl(runId, d.path)} download={d.filename}>
								{d.filename}
							</a>
							<span className="muted">
								{" "}
								{formatBytes(d.bytes)}
								{d.mime ? ` · ${d.mime}` : ""}
								{d.step !== undefined ? ` · step ${d.step}` : ""}
							</span>
							{d.text_excerpt ? <pre className="snapshot">{d.text_excerpt}</pre> : null}
						</li>
					))}
				</ul>
			)}
		</Panel>
	);
}

/* ---------- criteria ---------- */

export type CriteriaPanelProps = {
	criteriaIds: readonly string[];
	criteria: readonly CriterionResult[];
	judging: boolean;
};

export function CriteriaPanel({ criteriaIds, criteria, judging }: CriteriaPanelProps) {
	const scored = new Map(criteria.map((c) => [c.id, c]));
	const ids = [
		...criteriaIds,
		...criteria.map((c) => c.id).filter((id) => !criteriaIds.includes(id)),
	];
	return (
		<Panel title="Criteria">
			{ids.length === 0 ? (
				<p className="muted">
					{judging ? "The judge is reading the evidence…" : "Scored once the conversation ends."}
				</p>
			) : (
				<div className="table-wrap">
					<table className="table table--compact criteria">
						<thead>
							<tr>
								<th scope="col">Criterion</th>
								<th scope="col" className="num">
									Score
								</th>
								<th scope="col">Result</th>
							</tr>
						</thead>
						<tbody>
							{ids.map((id) => {
								const result = scored.get(id);
								return (
									<tr key={id} data-pass={result ? String(result.pass) : undefined}>
										<th scope="row" className="criteria__id">
											<span className="mono">{id}</span>
											{result?.required ? <span className="tag">required</span> : null}
											{result?.reason ? (
												<span className="criteria__reason">{result.reason}</span>
											) : null}
										</th>
										<td className="num">{result ? percent(result.score) : "…"}</td>
										<td className="criteria__result">
											{result ? (result.pass ? "pass" : "fail") : "pending"}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</Panel>
	);
}

/* ---------- verdict ---------- */

export function VerdictPanel({
	runId,
	verdict,
	hasReport,
}: {
	runId: string;
	verdict: Verdict;
	hasReport: boolean;
}) {
	const reportUrl = endpoints.reportUrl(runId);
	return (
		<Panel
			title="Verdict"
			className="verdict"
			actions={
				hasReport ? (
					<a className="btn btn--sm" href={reportUrl} target="_blank" rel="noopener noreferrer">
						Open report in a new tab
					</a>
				) : undefined
			}
		>
			<div className="verdict__summary">
				<ScoreGauge
					score={verdict.score}
					threshold={verdict.pass_threshold}
					status={verdict.status}
				/>
				<div className="verdict__text">
					<p className="verdict__headline">
						<span className="preview__status" data-status={verdict.status}>
							{verdict.status}
						</span>{" "}
						<span className="muted">
							· goal {verdict.goal_reached ? "reached" : "not reached"} · {verdict.turns_used}/
							{verdict.max_turns} turns
						</span>
					</p>
					<p>{verdict.summary}</p>
					{verdict.goal_assessment ? <p className="muted">{verdict.goal_assessment}</p> : null}
					<p className="muted">
						Judged {formatDateTime(verdict.judged_at)} by{" "}
						<code className="mono">{verdict.judge_model}</code>
					</p>
				</div>
			</div>
			{hasReport ? (
				<iframe className="report-frame" title="Report" src={reportUrl} loading="lazy" />
			) : (
				<p className="muted">The report file is not available for this run.</p>
			)}
		</Panel>
	);
}

/* ---------- logs ---------- */

export function LogsPanel({
	logs,
	errors,
}: {
	logs: readonly LogLine[];
	errors: readonly string[];
}) {
	if (logs.length === 0 && errors.length === 0) return null;
	return (
		<details className="panel logs">
			<summary>
				Log <span className="muted">({logs.length + errors.length})</span>
			</summary>
			<ol className="logs__list">
				{errors.map((message, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only, so the index is stable
					<li key={`e${i}-${message}`} data-level="warn">
						<span className="logs__level">error</span> {message}
					</li>
				))}
				{logs.map((line, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only, so the index is stable
					<li key={`${line.at}-${i}`} data-level={line.level}>
						<span className="logs__level">{line.level}</span> {line.message}
					</li>
				))}
			</ol>
		</details>
	);
}
