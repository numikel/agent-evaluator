import type { RunStatus } from "@schemas/run";

export type StatusBadgeProps = {
	status: RunStatus;
	/** Accessible name; `status` roles take none from their content, so pages with one badge set it. */
	label?: string;
};

/** Run status pill; colour comes from `data-status`, RUNNING/JUDGING pulse unless reduced motion. */
export function StatusBadge({ status, label }: StatusBadgeProps) {
	return (
		<span className="badge" role="status" data-status={status} aria-label={label}>
			{status}
		</span>
	);
}
