import { render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { routes } from "../app/routes.js";
import * as fx from "../mocks/fixtures.js";
import { server } from "../mocks/server.js";

function renderAt(path: string) {
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	render(<RouterProvider router={router} />);
	return router;
}

describe("DashboardPage", () => {
	it("lists the most recent runs, newest first, linking to each run", async () => {
		renderAt("/");
		const recent = await screen.findByRole("region", { name: /recent runs/i });
		const rows = (await within(recent).findAllByRole("row")).slice(1);
		expect(rows).toHaveLength(3);
		expect(rows[0]).toHaveTextContent(fx.RUNNING_RUN_ID);
		expect(rows[2]).toHaveTextContent(fx.FAILED_RUN_ID);
		expect(within(rows[0] as HTMLElement).getByRole("link")).toHaveAttribute(
			"href",
			`/runs/${fx.RUNNING_RUN_ID}`,
		);
		expect(within(rows[1] as HTMLElement).getByRole("status")).toHaveTextContent("PASSED");
	});

	it("caps the recent list at ten runs", async () => {
		const base = fx.toSummary(fx.runs[1] as (typeof fx.runs)[number]);
		const many = Array.from({ length: 14 }, (_, i) => ({
			...base,
			id: `run-${i}`,
			started_at: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
		}));
		server.use(http.get("*/api/runs", () => HttpResponse.json(many)));
		renderAt("/");
		const recent = await screen.findByRole("region", { name: /recent runs/i });
		const rows = (await within(recent).findAllByRole("row")).slice(1);
		expect(rows).toHaveLength(10);
		expect(rows[0]).toHaveTextContent("run-13");
	});

	it("derives the pass rate per scenario from the run list", async () => {
		renderAt("/");
		const rates = await screen.findByRole("region", { name: /pass rate/i });
		const row = await within(rates).findByRole("row", { name: new RegExp(fx.scenario.name) });
		expect(row).toHaveTextContent("50%");
		expect(row).toHaveTextContent("3");
		expect(within(row).getByRole("link", { name: fx.scenario.name })).toHaveAttribute(
			"href",
			`/runs?scenario=${fx.scenario.name}`,
		);
	});

	it("offers quick links to launch a run and browse", async () => {
		renderAt("/");
		await screen.findByRole("region", { name: /recent runs/i });
		expect(screen.getByRole("link", { name: /run a scenario/i })).toHaveAttribute(
			"href",
			"/runs?launch=1",
		);
		expect(screen.getByRole("link", { name: /all runs/i })).toHaveAttribute("href", "/runs");
		await waitFor(() =>
			expect(screen.getByTestId("workspace-count-scenarios")).toHaveTextContent("1"),
		);
	});

	it("shows an empty state when there are no runs", async () => {
		server.use(http.get("*/api/runs", () => HttpResponse.json([])));
		renderAt("/");
		expect(await screen.findByText(/no runs yet/i)).toBeInTheDocument();
	});
});
