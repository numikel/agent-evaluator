import { useParams } from "react-router";
import { RubricEditor } from "../editors/RubricEditor.js";
import { ResourceListPage } from "./ResourceListPage.js";

export function RubricsPage() {
	const { name } = useParams<{ name?: string }>();
	return (
		<div data-testid="page-rubrics">
			{name ? (
				<RubricEditor name={name} />
			) : (
				<ResourceListPage
					collection="rubrics"
					kind="rubric"
					title="Rubrics"
					lead="Weighted criteria the judge scores; required ones fail the run on their own."
				/>
			)}
		</div>
	);
}
