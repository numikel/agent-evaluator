import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { routes } from "../app/routes.js";

function renderAt(path: string) {
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	render(<RouterProvider router={router} />);
	return router;
}

describe("TargetEditor", () => {
	it("edits url, hints, timeouts and auth with the YAML in sync", async () => {
		renderAt("/targets/demo-chatbot");
		const url = await screen.findByLabelText("URL");
		expect(url).toHaveValue("http://localhost:3999");
		fireEvent.change(url, { target: { value: "https://example.test/chat" } });
		const source = screen.getByLabelText("YAML source") as HTMLTextAreaElement;
		expect(source.value).toContain("url: https://example.test/chat");

		fireEvent.change(screen.getByLabelText("Response timeout (ms)"), {
			target: { value: "90000" },
		});
		expect(source.value).toContain("response_ms: 90000");

		fireEvent.change(screen.getByLabelText("Login steps"), {
			target: { value: "Click Sign in and submit the form." },
		});
		expect(source.value).toContain("login_steps: Click Sign in and submit the form.");

		fireEvent.change(screen.getByLabelText("Hints"), { target: { value: "one\ntwo" } });
		expect(source.value).toContain("  - two");
	});

	it("removes the auth block when every auth field is cleared", async () => {
		renderAt("/targets/demo-chatbot");
		const steps = await screen.findByLabelText("Login steps");
		fireEvent.change(steps, { target: { value: "x" } });
		fireEvent.change(steps, { target: { value: "" } });
		const source = screen.getByLabelText("YAML source") as HTMLTextAreaElement;
		expect(source.value).not.toContain("auth:");
	});
});
