import type { CSSProperties } from "react";

export type ScoreGaugeProps = {
	/** Normalised score 0..1 (clamped). */
	score: number;
	/** Pass threshold 0..1; shown as a caption when given. */
	threshold?: number;
	status?: "PASSED" | "FAILED";
	/** `xs` is a 44 px ring for table rows. */
	size?: "xs" | "sm" | "lg";
	/** Accessible name prefix; defaults to "Score". */
	label?: string;
};

const clampPercent = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100);

/** Percentage ring — the one deliberately bold element of the UI. */
export function ScoreGauge({
	score,
	threshold,
	status,
	size = "lg",
	label = "Score",
}: ScoreGaugeProps) {
	const percent = clampPercent(score);
	const style = { "--gauge-pct": percent } as CSSProperties;
	const caption = threshold === undefined ? undefined : `threshold ${clampPercent(threshold)}%`;
	return (
		// biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot be drawn as a ring and does not expose aria-valuenow; the spec requires role="meter" + aria-value* here.
		<div
			className={`gauge${size === "lg" ? "" : ` gauge--${size}`}`}
			role="meter"
			aria-label={`${label} ${percent}%`}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
			data-status={status}
			style={style}
		>
			<div className="gauge__ring" aria-hidden="true">
				<span className="gauge__value">{percent}%</span>
			</div>
			{caption ? <span className="gauge__caption">{caption}</span> : null}
		</div>
	);
}
