import { NavLink, Outlet } from "react-router";
import { NAV_ITEMS } from "./nav.js";

/** Application shell: skip link, sidebar navigation (top strip on narrow screens) and content. */
export function Layout() {
	return (
		<>
			<a className="skip-link" href="#main">
				Skip to content
			</a>
			<div className="layout">
				<aside className="sidebar">
					<div className="brand">
						<span className="brand__name">agent-evaluator</span>
						<span className="brand__tag">UI-level chatbot evals</span>
					</div>
					<nav className="nav" aria-label="Primary">
						<ul>
							{NAV_ITEMS.map((item) => (
								<li key={item.to}>
									<NavLink to={item.to} end={item.end}>
										{item.label}
									</NavLink>
								</li>
							))}
						</ul>
					</nav>
				</aside>
				<main id="main" className="content" tabIndex={-1}>
					<Outlet />
				</main>
			</div>
		</>
	);
}
