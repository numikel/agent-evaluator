import type { ResourceSummary } from "@schemas/api";
import type { Scenario } from "@schemas/scenario";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../mocks/server.js";
import { ApiError, ApiValidationError, api } from "./client.js";

/** Resolves with the rejection reason of `promise`; fails the test if it resolves instead. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}

describe("api client", () => {
	it("GET returns typed JSON from the mock API", async () => {
		const scenarios = await api.get<ResourceSummary[]>("/api/scenarios");
		expect(scenarios.length).toBeGreaterThan(0);
		expect(scenarios[0]?.name).toBe("invoice-export-september");
		expect(scenarios[0]?.path).toMatch(/\.yaml$/);
	});

	it("GET of a single resource returns the parsed document", async () => {
		const scenario = await api.get<Scenario>("/api/scenarios/invoice-export-september");
		expect(scenario.persona).toBe("impatient-smb-owner");
		expect(scenario.max_turns).toBe(6);
	});

	it("PUT with an invalid body rejects with ApiValidationError carrying the issues", async () => {
		const error = await rejectionOf(
			api.put("/api/scenarios/invoice-export-september", { name: "" }),
		);
		expect(error).toBeInstanceOf(ApiValidationError);
		if (!(error instanceof ApiValidationError)) throw error;
		expect(error.status).toBe(422);
		expect(error.issues.length).toBeGreaterThan(0);
		expect(error.issues.every((i) => typeof i.path === "string" && i.message.length > 0)).toBe(
			true,
		);
	});

	it("PUT with a valid body resolves (204, no content)", async () => {
		const scenario = await api.get<Scenario>("/api/scenarios/invoice-export-september");
		await expect(
			api.put("/api/scenarios/invoice-export-september", { ...scenario, max_turns: 9 }),
		).resolves.toBeUndefined();
	});

	it("putText sends raw text with a text content type and surfaces 422 issues", async () => {
		await expect(
			api.putText("/api/scenarios/invoice-export-september", "name: invoice-export-september\n"),
		).rejects.toBeInstanceOf(ApiValidationError);
		const template = await api.get<string>("/api/templates/scenario");
		await expect(
			api.putText("/api/scenarios/invoice-export-september", template),
		).resolves.toBeUndefined();
	});

	it("maps non-validation failures to ApiError with status and message", async () => {
		const error = await rejectionOf(api.get("/api/personas/does-not-exist"));
		expect(error).toBeInstanceOf(ApiError);
		if (!(error instanceof ApiError)) throw error;
		expect(error).not.toBeInstanceOf(ApiValidationError);
		expect(error.status).toBe(404);
		expect(error.message).toMatch(/not found/i);
	});

	it("survives a non-JSON error body", async () => {
		server.use(http.get("*/api/health", () => HttpResponse.text("boom", { status: 500 })));
		const error = await rejectionOf(api.get("/api/health"));
		expect(error).toBeInstanceOf(ApiError);
		if (!(error instanceof ApiError)) throw error;
		expect(error.status).toBe(500);
		expect(error.message).toBe("boom");
	});

	it("POST sends a JSON body and returns the response", async () => {
		const res = await api.post<{ runIds: string[] }>("/api/runs", {
			scenario: "invoice-export-september",
		});
		expect(res.runIds).toHaveLength(1);
	});

	it("DELETE resolves with no content", async () => {
		await expect(api.del("/api/personas/impatient-smb-owner")).resolves.toBeUndefined();
	});
});
