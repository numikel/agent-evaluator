import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { routes } from "./routes.js";

function renderAt(path: string) {
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	return render(<RouterProvider router={router} />);
}

describe("routes", () => {
	it.each([
		["/", "page-dashboard"],
		["/personas", "page-personas"],
		["/personas/impatient-smb-owner", "page-personas"],
		["/scenarios", "page-scenarios"],
		["/scenarios/invoice-export-september", "page-scenarios"],
		["/rubrics", "page-rubrics"],
		["/rubrics/customer-support", "page-rubrics"],
		["/targets", "page-targets"],
		["/targets/demo-chatbot", "page-targets"],
		["/evaluator", "page-evaluator"],
		["/settings", "page-settings"],
		["/runs", "page-runs"],
		["/runs/20261019-100000-invoice-export-september-1", "page-run-detail"],
	])("renders %s as %s", async (path, testId) => {
		renderAt(path);
		expect(await screen.findByTestId(testId)).toBeInTheDocument();
	});

	it("renders a not-found page for unknown paths", async () => {
		renderAt("/nope");
		expect(await screen.findByTestId("page-not-found")).toBeInTheDocument();
	});

	it("exposes the resource name from the URL on detail routes", async () => {
		renderAt("/personas/impatient-smb-owner");
		const page = await screen.findByTestId("page-personas");
		expect(page).toHaveTextContent("impatient-smb-owner");
	});

	it("marks only the active sidebar link with aria-current", async () => {
		renderAt("/runs");
		await screen.findByTestId("page-runs");
		const nav = screen.getByRole("navigation", { name: /primary/i });
		const active = nav.querySelectorAll("[aria-current='page']");
		expect(active).toHaveLength(1);
		expect(active[0]).toHaveTextContent("Runs");
		expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
	});

	it("keeps the section link active on nested detail routes", async () => {
		renderAt("/scenarios/invoice-export-september");
		await screen.findByTestId("page-scenarios");
		expect(screen.getByRole("link", { name: "Scenarios" })).toHaveAttribute("aria-current", "page");
	});

	it("offers a skip link to the main content", async () => {
		renderAt("/");
		await screen.findByTestId("page-dashboard");
		const skip = screen.getByRole("link", { name: /skip to content/i });
		expect(skip).toHaveAttribute("href", "#main");
		expect(screen.getByRole("main")).toHaveAttribute("id", "main");
	});

	it("dashboard shows workspace counts from the API", async () => {
		renderAt("/");
		expect(await screen.findByTestId("workspace-count-scenarios")).toHaveTextContent("1");
	});
});
