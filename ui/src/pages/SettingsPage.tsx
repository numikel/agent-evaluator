import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";

export function SettingsPage() {
	return (
		<div data-testid="page-settings">
			<PageHeader
				title="Settings"
				lead="Models per role, browser options and server port. API keys stay in your environment."
			/>
			<Panel title="agent-evaluator.yaml">
				<p className="stub">Provider and model selection arrive in a later phase.</p>
			</Panel>
		</div>
	);
}
