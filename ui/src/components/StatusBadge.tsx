import type { RunStatus } from "@schemas/run";

export type StatusBadgeProps = { status: RunStatus };

/** Run status pill; colour comes from `data-status`, RUNNING/JUDGING pulse unless reduced motion. */
export function StatusBadge({ status }: StatusBadgeProps) {
	return (
		<span className="badge" role="status" data-status={status}>
			{status}
		</span>
	);
}
