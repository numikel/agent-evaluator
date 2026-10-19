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

describe("PersonaEditor", () => {
	it("propagates form edits to the Markdown source", async () => {
		renderAt("/personas/impatient-smb-owner");
		const description = await screen.findByLabelText("Description");
		fireEvent.change(description, { target: { value: "A new description" } });
		const source = screen.getByLabelText("Markdown source") as HTMLTextAreaElement;
		expect(source.value).toContain("description: A new description");
		expect(source.value.startsWith("---\n")).toBe(true);

		fireEvent.change(screen.getByLabelText("Traits"), { target: { value: "calm, curious" } });
		expect(source.value).toMatch(/traits:\n {2}- calm\n {2}- curious/);
	});

	it("propagates source edits back to the form", async () => {
		renderAt("/personas/impatient-smb-owner");
		const source = (await screen.findByLabelText("Markdown source")) as HTMLTextAreaElement;
		const edited = source.value.replace("language: en", "language: pl");
		fireEvent.change(source, { target: { value: edited } });
		expect(screen.getByLabelText("Language")).toHaveValue("pl");
		fireEvent.change(source, {
			target: { value: `${source.value.split("---\n\n")[0]}---\n\n# Rewritten\n` },
		});
		expect(screen.getByLabelText("Body (Markdown)")).toHaveValue("# Rewritten\n");
	});

	it("shows a parse error and disables the form when the source is not a persona", async () => {
		renderAt("/personas/impatient-smb-owner");
		const source = await screen.findByLabelText("Markdown source");
		fireEvent.change(source, { target: { value: "no frontmatter here" } });
		expect(screen.getByLabelText("Markdown source")).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByRole("alert")).toHaveTextContent(/frontmatter/i);
		expect(screen.getByLabelText("Description")).toBeDisabled();
	});

	it("validates on blur and saves the source text with PUT", async () => {
		const put = vi.fn();
		server.use(
			http.put("*/api/personas/:name", async ({ request, params }) => {
				put({
					name: params.name,
					type: request.headers.get("content-type"),
					body: await request.text(),
				});
				return new HttpResponse(null, { status: 204 });
			}),
		);
		renderAt("/personas/impatient-smb-owner");
		const description = await screen.findByLabelText("Description");
		fireEvent.change(description, { target: { value: "" } });
		fireEvent.blur(description);
		await waitFor(() => expect(description).toHaveAttribute("aria-invalid", "true"));
		expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

		fireEvent.change(description, { target: { value: "Fixed" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
		expect(put.mock.calls[0]?.[0]).toMatchObject({ name: "impatient-smb-owner" });
		expect(put.mock.calls[0]?.[0].type).toMatch(/^text\//);
		expect(put.mock.calls[0]?.[0].body).toContain("description: Fixed");
		expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
	});

	it("starts a new persona from the template with the chosen name", async () => {
		renderAt("/personas/fresh-face?new=1");
		expect(await screen.findByLabelText("Name")).toHaveValue("fresh-face");
		const source = screen.getByLabelText("Markdown source") as HTMLTextAreaElement;
		expect(source.value).toContain("name: fresh-face");
		const body = screen.getByLabelText("Body (Markdown)") as HTMLTextAreaElement;
		expect(body.value).toContain("# Background");
	});

	it("flags a name that does not match the file name", async () => {
		renderAt("/personas/impatient-smb-owner");
		const name = await screen.findByLabelText("Name");
		fireEvent.change(name, { target: { value: "someone-else" } });
		expect(name).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
	});
});
