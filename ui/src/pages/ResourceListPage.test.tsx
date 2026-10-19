import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { routes } from "../app/routes.js";
import { server } from "../mocks/server.js";

function renderAt(path: string) {
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	render(<RouterProvider router={router} />);
	return router;
}

describe("ResourceListPage", () => {
	it("lists resources with name, description and updated time", async () => {
		renderAt("/personas");
		const row = await screen.findByRole("row", { name: /impatient-smb-owner/ });
		expect(within(row).getByRole("link", { name: "impatient-smb-owner" })).toHaveAttribute(
			"href",
			"/personas/impatient-smb-owner",
		);
		expect(row).toHaveTextContent(/small business/i);
		expect(within(row).getByText(/2026/)).toBeInTheDocument();
	});

	it("deletes a resource only after confirmation", async () => {
		const del = vi.fn();
		server.use(
			http.delete("*/api/personas/:name", ({ params }) => {
				del(params.name);
				return new HttpResponse(null, { status: 204 });
			}),
		);
		renderAt("/personas");
		const row = await screen.findByRole("row", { name: /impatient-smb-owner/ });
		fireEvent.click(within(row).getByRole("button", { name: /delete/i }));
		expect(del).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
		expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
		fireEvent.click(within(row).getByRole("button", { name: /delete/i }));
		fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
		await waitFor(() => expect(del).toHaveBeenCalledWith("impatient-smb-owner"));
		await waitFor(() =>
			expect(screen.queryByRole("row", { name: /impatient-smb-owner/ })).not.toBeInTheDocument(),
		);
	});

	it("starts a new resource from the template under a chosen name", async () => {
		const router = renderAt("/scenarios");
		await screen.findByRole("row", { name: /invoice-export-september/ });
		fireEvent.click(screen.getByRole("button", { name: /new from template/i }));
		const name = screen.getByLabelText(/name/i);
		fireEvent.change(name, { target: { value: "Not A Slug" } });
		expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
		fireEvent.change(name, { target: { value: "refund-request" } });
		fireEvent.click(screen.getByRole("button", { name: /create/i }));
		await waitFor(() => expect(router.state.location.pathname).toBe("/scenarios/refund-request"));
		expect(router.state.location.search).toBe("?new=1");
	});

	it("shows an empty state", async () => {
		server.use(http.get("*/api/targets", () => HttpResponse.json([])));
		renderAt("/targets");
		expect(await screen.findByText(/no targets yet/i)).toBeInTheDocument();
	});
});
