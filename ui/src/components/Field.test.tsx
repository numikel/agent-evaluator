import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./Field.js";

describe("Field", () => {
	it("links label, hint and error to the control through the render prop", () => {
		render(
			<Field label="Max turns" hint="1 to 100" error="Required">
				{(control) => <input type="number" {...control} />}
			</Field>,
		);
		const input = screen.getByLabelText("Max turns");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input).toHaveAccessibleDescription("1 to 100 Required");
		expect(screen.getByRole("alert")).toHaveTextContent("Required");
	});

	it("renders static children and no aria-invalid when there is no error", () => {
		render(
			<Field label="Name">
				<input id="ignored" />
			</Field>,
		);
		expect(screen.getByText("Name")).toBeInTheDocument();
		expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});
});
