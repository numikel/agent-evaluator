import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { routes } from "../app/routes.js";
import * as fx from "../mocks/fixtures.js";
import { server } from "../mocks/server.js";

function renderAt(path: string) {
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	render(<RouterProvider router={router} />);
	return router;
}

const options = (select: HTMLElement) =>
	Array.from((select as HTMLSelectElement).options).map((o) => o.value);

describe("SettingsPage", () => {
	it("offers only configured providers in each role cascade", async () => {
		renderAt("/settings");
		const simulator = await screen.findByRole("group", { name: "Simulator" });
		const provider = within(simulator).getByLabelText("Provider");
		const configured = fx.providers.filter((p) => p.configured).map((p) => p.id);
		expect(options(provider)).toEqual(configured);
		expect(fx.providers.some((p) => !p.configured)).toBe(true);
		const selector = screen.getByRole("group", { name: "Evidence selector" });
		expect(options(within(selector).getByLabelText("Provider"))).toEqual(["", ...configured]);
	});

	it("loads models when the provider changes and flags fallback lists", async () => {
		const requested: string[] = [];
		server.use(
			http.get("*/api/providers/:id/models", ({ params, request }) => {
				requested.push(`${String(params.id)}${new URL(request.url).search}`);
				return HttpResponse.json(fx.providerModels(String(params.id)));
			}),
		);
		renderAt("/settings");
		const simulator = await screen.findByRole("group", { name: "Simulator" });
		const model = within(simulator).getByLabelText("Model");
		await waitFor(() => expect(options(model)).toContain("mock-large"));
		expect(within(simulator).queryByText(/fallback list/i)).not.toBeInTheDocument();
		expect(within(simulator).getByText(/200,000/)).toBeInTheDocument();

		fireEvent.change(within(simulator).getByLabelText("Provider"), { target: { value: "ollama" } });
		await waitFor(() => expect(requested).toContain("ollama"));
		expect(await within(simulator).findByText(/fallback list/i)).toBeInTheDocument();
		fireEvent.click(within(simulator).getByRole("button", { name: /refresh/i }));
		await waitFor(() => expect(requested).toContain("ollama?refresh=1"));
	});

	it("saves the chosen effort in the PUT body", async () => {
		const put = vi.fn();
		server.use(
			http.put("*/api/settings", async ({ request }) => {
				const body = await request.json();
				put(body);
				return HttpResponse.json({
					settings: body,
					providers: fx.providers,
					browser_installed: true,
				});
			}),
		);
		renderAt("/settings");
		const judge = await screen.findByRole("group", { name: "Judge" });
		const effort = within(judge).getByLabelText("Effort");
		expect(options(effort)).toEqual(["", "none", "low", "medium", "high", "max"]);
		fireEvent.change(effort, { target: { value: "high" } });
		fireEvent.change(within(judge).getByLabelText("Temperature"), { target: { value: "0.3" } });
		fireEvent.change(screen.getByLabelText("Concurrency"), { target: { value: "3" } });
		fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
		await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
		expect(put.mock.calls[0]?.[0]).toMatchObject({
			effort: { judge: "high" },
			temperature: { judge: 0.3 },
			concurrency: 3,
		});
		expect(put.mock.calls[0]?.[0].effort).not.toHaveProperty("simulator");
		expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
	});

	it("warns when the browser is not installed and explains the empty provider state", async () => {
		server.use(
			http.get("*/api/settings", () =>
				HttpResponse.json({ settings: fx.settings, providers: [], browser_installed: false }),
			),
			http.get("*/api/providers", () => HttpResponse.json([])),
		);
		renderAt("/settings");
		expect(await screen.findByText(/npx playwright install chromium/)).toBeInTheDocument();
		expect(screen.getByText(/no provider is configured/i)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /secrets/i })).toHaveAttribute(
			"href",
			expect.stringContaining("#secrets"),
		);
	});
});
