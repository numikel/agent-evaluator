import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("EvaluatorPage", () => {
	it("edits principles, max images and the default rubric with YAML in sync", async () => {
		renderAt("/evaluator");
		const principles = (await screen.findByLabelText("Principles")) as HTMLTextAreaElement;
		expect(principles.value).toContain("customer-facing chatbot");
		const rubric = screen.getByLabelText("Default rubric") as HTMLSelectElement;
		expect(Array.from(rubric.options).map((o) => o.value)).toEqual(["", "customer-support"]);
		fireEvent.change(screen.getByLabelText("Max images"), { target: { value: "4" } });
		const source = screen.getByLabelText("YAML source") as HTMLTextAreaElement;
		expect(source.value).toContain("max_images: 4");
	});

	it("saves the YAML text with PUT /api/evaluator", async () => {
		const put = vi.fn();
		server.use(
			http.put("*/api/evaluator", async ({ request }) => {
				put({ type: request.headers.get("content-type"), body: await request.text() });
				return HttpResponse.json({});
			}),
		);
		renderAt("/evaluator");
		const maxImages = await screen.findByLabelText("Max images");
		fireEvent.change(maxImages, { target: { value: "7" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
		expect(put.mock.calls[0]?.[0].body).toContain("max_images: 7");
		expect(put.mock.calls[0]?.[0].type).toMatch(/^text\//);
	});
});
