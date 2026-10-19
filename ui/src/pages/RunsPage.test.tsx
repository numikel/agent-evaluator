import type { StartRunRequest } from "@schemas/api";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const otherScenarioRun = {
	...fx.toSummary(fx.runs[1] as (typeof fx.runs)[number]),
	id: "20261017-090000-refund-request-1",
	scenario: "refund-request",
	status: "FAILED" as const,
	score: 0.3,
};

describe("RunsPage", () => {
	it("lists runs with scenario, persona, target, status, score, turns, start and duration", async () => {
		renderAt("/runs");
		const row = await screen.findByRole("row", { name: new RegExp(fx.PASSED_RUN_ID) });
		expect(within(row).getByRole("link", { name: fx.scenario.name })).toHaveAttribute(
			"href",
			`/runs/${fx.PASSED_RUN_ID}`,
		);
		expect(row).toHaveTextContent(fx.scenario.persona);
		expect(row).toHaveTextContent(fx.scenario.target);
		expect(within(row).getByRole("status")).toHaveTextContent("PASSED");
		expect(within(row).getByRole("meter")).toHaveAttribute(
			"aria-valuenow",
			String(Math.round(fx.verdict.score * 100)),
		);
		expect(row).toHaveTextContent(`4/${fx.scenario.max_turns}`);
		expect(row.querySelector("time")).toHaveTextContent(/2026/);
		expect(row).toHaveTextContent("4m 12s");
		const running = screen.getByRole("row", { name: new RegExp(fx.RUNNING_RUN_ID) });
		expect(within(running).queryByRole("meter")).not.toBeInTheDocument();
	});

	it("filters by status and by scenario", async () => {
		server.use(
			http.get("*/api/runs", () =>
				HttpResponse.json([...fx.runs.map(fx.toSummary), otherScenarioRun]),
			),
		);
		renderAt("/runs");
		await screen.findByRole("row", { name: new RegExp(fx.PASSED_RUN_ID) });
		const rows = () => screen.getAllByRole("row").slice(1);
		expect(rows()).toHaveLength(4);
		fireEvent.change(screen.getByLabelText(/filter by status/i), { target: { value: "FAILED" } });
		expect(rows()).toHaveLength(2);
		fireEvent.change(screen.getByLabelText(/filter by scenario/i), {
			target: { value: "refund-request" },
		});
		expect(rows()).toHaveLength(1);
		expect(rows()[0]).toHaveTextContent("refund-request");
		fireEvent.change(screen.getByLabelText(/filter by status/i), { target: { value: "" } });
		fireEvent.change(screen.getByLabelText(/filter by scenario/i), { target: { value: "" } });
		expect(rows()).toHaveLength(4);
	});

	it("pre-selects the scenario filter from the query string", async () => {
		server.use(
			http.get("*/api/runs", () =>
				HttpResponse.json([...fx.runs.map(fx.toSummary), otherScenarioRun]),
			),
		);
		renderAt("/runs?scenario=refund-request");
		await screen.findByRole("row", { name: /refund-request/ });
		expect(screen.getAllByRole("row").slice(1)).toHaveLength(1);
		expect(screen.getByLabelText(/filter by scenario/i)).toHaveValue("refund-request");
	});

	it("starts a run from the launcher with the chosen options and opens the first run", async () => {
		let body: StartRunRequest | undefined;
		server.use(
			http.post("*/api/runs", async ({ request }) => {
				body = (await request.json()) as StartRunRequest;
				return HttpResponse.json({ runIds: ["run-a", "run-b"] }, { status: 202 });
			}),
		);
		const router = renderAt("/runs");
		await screen.findByRole("row", { name: new RegExp(fx.PASSED_RUN_ID) });
		fireEvent.click(screen.getByRole("button", { name: /run scenario/i }));
		const dialog = await screen.findByRole("dialog", { name: /run scenario/i });
		const scenario = await within(dialog).findByLabelText(/^scenario/i);
		await waitFor(() =>
			expect(within(scenario).getByRole("option", { name: fx.scenario.name })).toBeInTheDocument(),
		);
		fireEvent.change(scenario, { target: { value: fx.scenario.name } });
		const target = within(dialog).getByLabelText(/target/i);
		await waitFor(() =>
			expect(within(target).getByRole("option", { name: fx.target.name })).toBeInTheDocument(),
		);
		fireEvent.change(target, { target: { value: fx.target.name } });
		fireEvent.change(within(dialog).getByLabelText(/repeat/i), { target: { value: "2" } });
		fireEvent.click(within(dialog).getByLabelText(/headed/i));
		fireEvent.click(within(dialog).getByRole("button", { name: /^start/i }));
		await waitFor(() =>
			expect(body).toEqual({
				scenario: fx.scenario.name,
				target: fx.target.name,
				repeat: 2,
				headless: false,
			}),
		);
		await waitFor(() => expect(router.state.location.pathname).toBe("/runs/run-a"));
	});

	it("omits the target override and keeps headless by default", async () => {
		let body: StartRunRequest | undefined;
		server.use(
			http.post("*/api/runs", async ({ request }) => {
				body = (await request.json()) as StartRunRequest;
				return HttpResponse.json({ runIds: ["run-c"] }, { status: 202 });
			}),
		);
		renderAt("/runs?launch=1");
		const dialog = await screen.findByRole("dialog", { name: /run scenario/i });
		const scenario = within(dialog).getByLabelText(/^scenario/i);
		await waitFor(() => expect(scenario).toHaveValue(fx.scenario.name));
		fireEvent.click(within(dialog).getByRole("button", { name: /^start/i }));
		await waitFor(() =>
			expect(body).toEqual({ scenario: fx.scenario.name, repeat: 1, headless: true }),
		);
	});

	it("shows the server's error inside the dialog and keeps it open", async () => {
		server.use(
			http.post("*/api/runs", () =>
				HttpResponse.json(
					{ error: "precondition_failed", message: "browser is not installed" },
					{ status: 409 },
				),
			),
		);
		renderAt("/runs?launch=1");
		const dialog = await screen.findByRole("dialog", { name: /run scenario/i });
		await waitFor(() =>
			expect(within(dialog).getByLabelText(/^scenario/i)).toHaveValue(fx.scenario.name),
		);
		fireEvent.click(within(dialog).getByRole("button", { name: /^start/i }));
		expect(await within(dialog).findByRole("alert")).toHaveTextContent(/browser is not installed/);
		expect(screen.getByRole("dialog", { name: /run scenario/i })).toBeInTheDocument();
	});

	it("closes the dialog with Escape and with the Cancel button", async () => {
		renderAt("/runs?launch=1");
		const dialog = await screen.findByRole("dialog", { name: /run scenario/i });
		fireEvent.keyDown(dialog, { key: "Escape" });
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /run scenario/i }));
		const again = await screen.findByRole("dialog", { name: /run scenario/i });
		fireEvent.click(within(again).getByRole("button", { name: /cancel/i }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("shows an empty state", async () => {
		server.use(http.get("*/api/runs", () => HttpResponse.json([])));
		renderAt("/runs");
		expect(await screen.findByText(/no runs yet/i)).toBeInTheDocument();
	});
});
