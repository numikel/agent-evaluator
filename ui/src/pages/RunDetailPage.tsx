/**
 * Live view of one run: overview (status, turn, elapsed), evidence strip of step screenshots,
 * transcript, downloads and criteria filling in from the SSE stream; the verdict with the
 * embedded report once the run is done. Finished runs render from the stored record.
 */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { endpoints } from "../api/client.js";
import { PageHeader } from "../components/PageHeader.js";
import { errorMessage } from "../hooks/useAsync.js";
import {
	CriteriaPanel,
	DownloadsPanel,
	EvidenceStrip,
	LogsPanel,
	RunOverview,
	StepPanel,
	TranscriptPanel,
	VerdictPanel,
} from "../runs/panels.js";
import { isTerminalStatus } from "../runs/reducer.js";
import { useElapsedMs, useRunStream } from "../runs/useRunStream.js";

const CANCELLABLE = new Set(["PENDING", "RUNNING", "JUDGING"]);

export function RunDetailPage() {
	const { id = "" } = useParams<{ id: string }>();
	const { state, connection, loadError } = useRunStream(id);
	const elapsedMs = useElapsedMs(state.startedAt, state.finishedAt);
	const [selectedStep, setSelectedStep] = useState<number | undefined>(undefined);
	const [cancelling, setCancelling] = useState(false);
	const [cancelError, setCancelError] = useState<string | undefined>(undefined);

	const cancel = async () => {
		setCancelling(true);
		setCancelError(undefined);
		try {
			await endpoints.cancelRun(id);
		} catch (error) {
			setCancelError(errorMessage(error));
			setCancelling(false);
		}
	};

	const terminal = isTerminalStatus(state.status);
	const selected = state.steps.find((s) => s.index === selectedStep);
	const run = state.run;

	return (
		<div data-testid="page-run-detail">
			<PageHeader
				title={run?.scenario ?? "Run"}
				lead={
					<>
						<code className="mono">{id}</code> · <Link to="/runs">All runs</Link>
					</>
				}
			/>
			{loadError ? (
				<p className="notice notice--error" role="alert">
					Could not load run: {loadError}
				</p>
			) : null}
			{state.fatalError ? (
				<div className="notice notice--error" role="alert">
					<p>
						<strong>The run ended with an error:</strong> {state.fatalError}
					</p>
					<p>
						The browser session was closed and no verdict was produced. The evidence collected so
						far stays below; check the log, the target URL and the provider configuration on the
						Settings page, then start the run again.
					</p>
				</div>
			) : null}
			{cancelError ? (
				<p className="notice notice--error" role="alert">
					Could not cancel the run: {cancelError}
				</p>
			) : null}
			{!loadError ? (
				<RunOverview
					status={state.status}
					turn={state.turn}
					maxTurns={state.maxTurns}
					elapsedMs={elapsedMs}
					startedAt={state.startedAt}
					scenario={run?.scenario}
					persona={run?.persona}
					target={run?.target}
					repeat={run ? { index: run.repeat_index, total: run.repeat_total } : undefined}
					connection={connection}
					cancellable={CANCELLABLE.has(state.status) && !terminal && connection !== "loading"}
					cancelling={cancelling}
					onCancel={() => void cancel()}
				/>
			) : null}
			{state.verdict ? (
				<VerdictPanel runId={id} verdict={state.verdict} hasReport={state.report !== undefined} />
			) : null}
			{!loadError ? (
				<>
					<EvidenceStrip
						runId={id}
						steps={state.steps}
						selected={selectedStep}
						onSelect={(index) => setSelectedStep(index === selectedStep ? undefined : index)}
					/>
					{selected ? (
						<StepPanel runId={id} step={selected} onClose={() => setSelectedStep(undefined)} />
					) : null}
					<div className="run-grid">
						<TranscriptPanel entries={state.transcript} />
						<div className="run-grid__side">
							<CriteriaPanel
								criteriaIds={state.criteriaIds}
								criteria={state.criteria}
								judging={state.status === "JUDGING"}
							/>
							<DownloadsPanel runId={id} downloads={state.downloads} />
						</div>
					</div>
					<LogsPanel logs={state.logs} errors={state.errors} />
				</>
			) : null}
		</div>
	);
}
