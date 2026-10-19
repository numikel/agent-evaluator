import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { routes } from "../app/routes.js";

function renderAt(path: string) {
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	render(<RouterProvider router={router} />);
	return router;
}

describe("ScenarioEditor", () => {
	it("shows the issue path next to the field after validation on blur", async () => {
		renderAt("/scenarios/invoice-export-september");
		const goal = await screen.findByLabelText("Goal");
		fireEvent.change(goal, { target: { value: "" } });
		fireEvent.blur(goal);
		await waitFor(() => expect(goal).toHaveAttribute("aria-invalid", "true"));
		expect(goal).toHaveAccessibleDescription(expect.stringMatching(/character|string/i));
		const summary = screen.getByRole("region", { name: /issues/i });
		expect(summary).toHaveTextContent("goal");
	});

	it("keeps form and YAML in sync in both directions", async () => {
		renderAt("/scenarios/invoice-export-september");
		const maxTurns = await screen.findByLabelText("Max turns");
		fireEvent.change(maxTurns, { target: { value: "9" } });
		const source = screen.getByLabelText("YAML source") as HTMLTextAreaElement;
		expect(source.value).toContain("max_turns: 9");

		fireEvent.change(source, {
			target: { value: source.value.replace("max_turns: 9", "max_turns: 3") },
		});
		expect(screen.getByLabelText("Max turns")).toHaveValue(3);
	});

	it("offers personas, targets and rubrics from the workspace", async () => {
		renderAt("/scenarios/invoice-export-september");
		const persona = (await screen.findByLabelText("Persona")) as HTMLSelectElement;
		expect(Array.from(persona.options).map((o) => o.value)).toContain("impatient-smb-owner");
		const rubric = screen.getByLabelText("Rubric") as HTMLSelectElement;
		expect(Array.from(rubric.options).map((o) => o.value)).toEqual(["", "customer-support"]);
	});

	it("edits expected artifacts and examples as lists", async () => {
		renderAt("/scenarios/invoice-export-september");
		await screen.findByLabelText("Goal");
		fireEvent.click(screen.getByRole("button", { name: /add artifact/i }));
		const source = screen.getByLabelText("YAML source") as HTMLTextAreaElement;
		expect(source.value.match(/- type: /g)).toHaveLength(2);
		fireEvent.change(screen.getByLabelText("Examples"), {
			target: { value: "first phrasing\nsecond phrasing" },
		});
		expect(source.value).toContain("  - second phrasing");
	});
});
