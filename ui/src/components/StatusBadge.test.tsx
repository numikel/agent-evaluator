import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge.js";

describe("StatusBadge", () => {
	it.each(["PENDING", "RUNNING", "JUDGING", "PASSED", "FAILED", "ERROR"] as const)(
		"renders %s as a status element",
		(status) => {
			render(<StatusBadge status={status} />);
			const badge = screen.getByRole("status");
			expect(badge).toHaveTextContent(status);
			expect(badge).toHaveAttribute("data-status", status);
		},
	);
});
