import { Link, useParams } from "react-router";
import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";

export function RunDetailPage() {
	const { id = "" } = useParams<{ id: string }>();
	return (
		<div data-testid="page-run-detail">
			<PageHeader title="Run" lead={<code className="mono">{id}</code>} />
			<Panel title="Live view and verdict">
				<div className="stub">
					<p>Transcript, steps, screenshots and the verdict arrive in a later phase.</p>
					<p>
						<Link to="/runs">Back to runs</Link>
					</p>
				</div>
			</Panel>
		</div>
	);
}
