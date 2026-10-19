import { useParams } from "react-router";
import { ScenarioEditor } from "../editors/ScenarioEditor.js";
import { ResourceListPage } from "./ResourceListPage.js";

export function ScenariosPage() {
	const { name } = useParams<{ name?: string }>();
	return (
		<div data-testid="page-scenarios">
			{name ? (
				<ScenarioEditor name={name} />
			) : (
				<ResourceListPage
					collection="scenarios"
					kind="scenario"
					title="Scenarios"
					lead="What the simulated user is trying to achieve, and how the judge knows it happened."
				/>
			)}
		</div>
	);
}
