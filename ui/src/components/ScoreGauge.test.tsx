import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreGauge } from "./ScoreGauge.js";

describe("ScoreGauge", () => {
	it("renders the rounded percentage and an accessible meter", () => {
		render(<ScoreGauge score={0.874} />);
		const meter = screen.getByRole("meter");
		expect(meter).toHaveAttribute("aria-valuenow", "87");
		expect(meter).toHaveAttribute("aria-valuemin", "0");
		expect(meter).toHaveAttribute("aria-valuemax", "100");
		expect(meter).toHaveAccessibleName("Score 87%");
		expect(screen.getByText("87%")).toBeInTheDocument();
	});

	it("clamps out-of-range scores and shows the pass threshold when given", () => {
		render(<ScoreGauge score={1.4} threshold={0.7} status="PASSED" />);
		const meter = screen.getByRole("meter");
		expect(meter).toHaveAttribute("aria-valuenow", "100");
		expect(meter).toHaveAttribute("data-status", "PASSED");
		expect(screen.getByText(/threshold 70%/i)).toBeInTheDocument();
	});
});
