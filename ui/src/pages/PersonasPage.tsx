import { useParams } from "react-router";
import { PersonaEditor } from "../editors/PersonaEditor.js";
import { ResourceListPage } from "./ResourceListPage.js";

export function PersonasPage() {
	const { name } = useParams<{ name?: string }>();
	return (
		<div data-testid="page-personas">
			{name ? (
				<PersonaEditor name={name} />
			) : (
				<ResourceListPage
					collection="personas"
					kind="persona"
					title="Personas"
					lead="Who the simulated user is: traits, style and background in Markdown."
				/>
			)}
		</div>
	);
}
