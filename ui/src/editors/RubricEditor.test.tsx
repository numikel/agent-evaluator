import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { routes } from "../app/routes.js";

function renderAt(path: string) {
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	render(<RouterProvider router={router} />);
	return router;
}

describe("RubricEditor", () => {
	it("lists the criteria with type-specific fields", async () => {
		renderAt("/rubrics/customer-support");
		const tone = await screen.findByRole("group", { name: /tone/ });
		expect(within(tone).getByLabelText("Type")).toHaveValue("llm");
		expect(within(tone).getByLabelText("Scale")).toHaveValue("0-5");
		const regex = screen.getByRole("group", { name: /mentions_month/ });
		expect(within(regex).getByLabelText("Pattern")).toHaveValue("sept(ember)?");
		expect(within(regex).queryByLabelText("Scale")).not.toBeInTheDocument();
	});

	it("adds a criterion of the chosen type and reflects it in the YAML", async () => {
		renderAt("/rubrics/customer-support");
		await screen.findByRole("group", { name: /tone/ });
		fireEvent.change(screen.getByLabelText("New criterion type"), {
			target: { value: "contains" },
		});
		fireEvent.click(screen.getByRole("button", { name: /add criterion/i }));
		const added = screen.getByRole("group", { name: /criterion-8/ });
		expect(within(added).getByLabelText("Text")).toBeInTheDocument();
		const source = screen.getByLabelText("YAML source") as HTMLTextAreaElement;
		expect(source.value).toContain("type: contains");
	});

	it("previews the weighted score live and reacts to simulated failures", async () => {
		renderAt("/rubrics/customer-support");
		await screen.findByRole("group", { name: /tone/ });
		const preview = screen.getByRole("region", { name: /score preview/i });
		expect(within(preview).getByText(/100%/)).toBeInTheDocument();
		expect(within(preview).getByText("PASSED")).toBeInTheDocument();
		const goalRow = within(preview).getByRole("row", { name: /goal_reached/ });
		expect(goalRow).toHaveTextContent(/built-in/i);
		fireEvent.click(within(goalRow).getByRole("checkbox"));
		expect(within(preview).getByText("FAILED")).toBeInTheDocument();
	});

	it("changes the weight from the form and updates the preview share", async () => {
		renderAt("/rubrics/customer-support");
		const tone = await screen.findByRole("group", { name: /tone/ });
		fireEvent.change(within(tone).getByLabelText("Weight"), { target: { value: "9" } });
		const source = screen.getByLabelText("YAML source") as HTMLTextAreaElement;
		expect(source.value).toContain("weight: 9");
		const preview = screen.getByRole("region", { name: /score preview/i });
		const toneRow = within(preview).getByRole("row", { name: /tone/ });
		expect(toneRow).toHaveTextContent("9");
	});
});
