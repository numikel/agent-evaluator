/**
 * "Run scenario" dialog: scenario (from `/api/scenarios`), optional target override (from
 * `/api/targets`), repeat count and headed browser → `POST /api/runs`. A plain `role="dialog"`
 * rather than `<dialog>`: it keeps focus handling explicit and testable in jsdom.
 */
import type { StartRunRequest } from "@schemas/api";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { endpoints } from "../api/client.js";
import { Button } from "../components/Button.js";
import { CheckboxField, NumberField, SelectField } from "../components/FormFields.js";
import { errorMessage, useAsync } from "../hooks/useAsync.js";

export type RunLauncherProps = {
	/** Pre-selected scenario, e.g. from the runs filter. */
	initialScenario?: string;
	onClose(): void;
	onStarted(runIds: string[]): void;
};

const MAX_REPEAT = 50;

export function RunLauncher({ initialScenario, onClose, onStarted }: RunLauncherProps) {
	const titleId = useId();
	const dialogRef = useRef<HTMLDivElement>(null);
	const options = useAsync(
		() => Promise.all([endpoints.list("scenarios"), endpoints.list("targets")]),
		"launcher",
	);
	const [scenario, setScenario] = useState(initialScenario ?? "");
	const [target, setTarget] = useState("");
	const [repeat, setRepeat] = useState<number | undefined>(1);
	const [headed, setHeaded] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);

	useEffect(() => {
		dialogRef.current?.focus();
	}, []);

	const scenarios = options.status === "ready" ? options.data[0] : [];
	const targets = options.status === "ready" ? options.data[1] : [];
	const effectiveScenario =
		scenario !== "" && scenarios.some((s) => s.name === scenario)
			? scenario
			: (scenarios[0]?.name ?? "");
	const repeatOk = repeat !== undefined && Number.isInteger(repeat) && repeat >= 1;
	const repeatError = repeatOk
		? repeat > MAX_REPEAT
			? `At most ${MAX_REPEAT} repeats.`
			: undefined
		: "Enter a whole number of at least 1.";
	const canStart =
		options.status === "ready" && effectiveScenario !== "" && !repeatError && !submitting;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!canStart || repeat === undefined) return;
		const body: StartRunRequest = { scenario: effectiveScenario, repeat, headless: !headed };
		if (target !== "") body.target = target;
		setSubmitting(true);
		setError(undefined);
		try {
			const { runIds } = await endpoints.startRun(body);
			onStarted(runIds);
		} catch (cause) {
			setError(errorMessage(cause));
			setSubmitting(false);
		}
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			event.stopPropagation();
			onClose();
		}
	};

	return (
		<div className="dialog-backdrop">
			{/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Escape-to-close is the dialog's standard keyboard affordance; the handler lives on the focusable dialog container. */}
			<div
				ref={dialogRef}
				className="dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				onKeyDown={onKeyDown}
			>
				<h2 className="dialog__title" id={titleId}>
					Run scenario
				</h2>
				{options.status === "error" ? (
					<p className="inline-error" role="alert">
						Could not load scenarios and targets: {options.message}
					</p>
				) : null}
				<form onSubmit={(e) => void submit(e)}>
					<SelectField
						label="Scenario"
						value={effectiveScenario}
						disabled={options.status !== "ready"}
						options={
							options.status === "ready"
								? scenarios.length === 0
									? [{ value: "", label: "No scenarios in the workspace", disabled: true }]
									: scenarios.map((s) => ({ value: s.name, label: s.name }))
								: [{ value: "", label: "Loading…", disabled: true }]
						}
						onChange={setScenario}
					/>
					<SelectField
						label="Target override"
						hint="Leave on the scenario default unless you want to point this run elsewhere."
						value={target}
						disabled={options.status !== "ready"}
						options={[
							{ value: "", label: "Scenario default" },
							...targets.map((t) => ({ value: t.name, label: t.name })),
						]}
						onChange={setTarget}
					/>
					<NumberField
						label="Repeat"
						hint="Runs the scenario this many times; each gets its own run id."
						value={repeat}
						min={1}
						max={MAX_REPEAT}
						step={1}
						error={repeat === undefined && !submitting ? undefined : repeatError}
						onChange={setRepeat}
					/>
					<CheckboxField
						label="Headed browser"
						hint="Show the Chromium window while the simulator drives the target."
						checked={headed}
						onChange={setHeaded}
					/>
					{error ? (
						<p className="inline-error" role="alert">
							Could not start the run: {error}
						</p>
					) : null}
					<div className="dialog__actions">
						<Button type="submit" variant="primary" disabled={!canStart}>
							{submitting ? "Starting…" : "Start"}
						</Button>
						<Button onClick={onClose}>Cancel</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
