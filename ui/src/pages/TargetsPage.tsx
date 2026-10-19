import { useParams } from "react-router";
import { TargetEditor } from "../editors/TargetEditor.js";
import { ResourceListPage } from "./ResourceListPage.js";

export function TargetsPage() {
	const { name } = useParams<{ name?: string }>();
	return (
		<div data-testid="page-targets">
			{name ? (
				<TargetEditor name={name} />
			) : (
				<ResourceListPage
					collection="targets"
					kind="target"
					title="Targets"
					lead="The chatbot under test: URL, optional login and hints for tricky interfaces."
				/>
			)}
		</div>
	);
}
