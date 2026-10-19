import { Link, useParams } from "react-router";
import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";

export type ResourceStubProps = {
	/** URL segment and test id suffix, e.g. `personas`. */
	collection: "personas" | "scenarios" | "rubrics" | "targets";
	title: string;
	lead: string;
};

/** Shared stub for the four resource sections; P12a replaces it with list + editor views. */
export function ResourceStub({ collection, title, lead }: ResourceStubProps) {
	const { name } = useParams<{ name?: string }>();
	return (
		<div data-testid={`page-${collection}`}>
			<PageHeader title={name ? `${title} / ${name}` : title} lead={lead} />
			<Panel title={name ? "Editor" : "List"}>
				<div className="stub">
					{name ? (
						<>
							<p>
								Editing <code className="mono">{name}</code>
							</p>
							<p>
								<Link to={`/${collection}`}>Back to {title.toLowerCase()}</Link>
							</p>
						</>
					) : (
						<p>Listing and editing arrive in a later phase.</p>
					)}
				</div>
			</Panel>
		</div>
	);
}
