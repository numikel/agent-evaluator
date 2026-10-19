import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";

export function RunsPage() {
	return (
		<div data-testid="page-runs">
			<PageHeader title="Runs" lead="Every evaluation run with its status and score." />
			<Panel title="History">
				<p className="stub">The run list and launcher arrive in a later phase.</p>
			</Panel>
		</div>
	);
}
