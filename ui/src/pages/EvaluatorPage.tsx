import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";

export function EvaluatorPage() {
	return (
		<div data-testid="page-evaluator">
			<PageHeader
				title="Evaluator"
				lead="Global principles the judge applies to every run, plus evidence limits."
			/>
			<Panel title="evaluator.yaml">
				<p className="stub">The editor arrives in a later phase.</p>
			</Panel>
		</div>
	);
}
