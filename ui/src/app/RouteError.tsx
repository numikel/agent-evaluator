import { isRouteErrorResponse, Link, useRouteError } from "react-router";

/** Root error boundary: keeps the shell usable when a page throws. */
export function RouteError() {
	const error = useRouteError();
	const title = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : "Error";
	const detail = isRouteErrorResponse(error)
		? error.data
		: error instanceof Error
			? error.message
			: String(error);
	return (
		<main id="main" className="content error-page" tabIndex={-1}>
			<h1>{title}</h1>
			<p className="muted">{typeof detail === "string" ? detail : "Something went wrong."}</p>
			<p>
				<Link to="/">Back to the dashboard</Link>
			</p>
		</main>
	);
}
