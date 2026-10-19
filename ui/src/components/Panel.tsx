import { type ReactNode, useId } from "react";

export type PanelProps = {
	title?: string;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
};

/** Bordered surface with an optional heading row; labelled by its title for assistive tech. */
export function Panel({ title, actions, children, className }: PanelProps) {
	const titleId = useId();
	return (
		<section
			className={`panel${className ? ` ${className}` : ""}`}
			aria-labelledby={title ? titleId : undefined}
		>
			{title || actions ? (
				<div className="panel__head">
					{title ? (
						<h2 className="panel__title" id={titleId}>
							{title}
						</h2>
					) : null}
					{actions ? <div className="panel__actions">{actions}</div> : null}
				</div>
			) : null}
			{children}
		</section>
	);
}
