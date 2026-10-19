import { Link, useLocation } from "react-router";
import { PageHeader } from "../components/PageHeader.js";

export function NotFoundPage() {
	const { pathname } = useLocation();
	return (
		<div data-testid="page-not-found" className="error-page">
			<PageHeader title="Page not found" lead={<code className="mono">{pathname}</code>} />
			<p>
				<Link to="/">Back to the dashboard</Link>
			</p>
		</div>
	);
}
