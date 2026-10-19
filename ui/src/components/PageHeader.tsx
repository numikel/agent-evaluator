import type { ReactNode } from "react";

export type PageHeaderProps = {
	title: string;
	lead?: ReactNode;
	actions?: ReactNode;
};

export function PageHeader({ title, lead, actions }: PageHeaderProps) {
	return (
		<header className="page-header">
			<div>
				<h1>{title}</h1>
				{lead ? <p className="page-header__lead">{lead}</p> : null}
			</div>
			{actions ? <div className="page-header__actions">{actions}</div> : null}
		</header>
	);
}
