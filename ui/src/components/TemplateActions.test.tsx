import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import * as fx from "../mocks/fixtures.js";
import { server } from "../mocks/server.js";
import { TemplateActions } from "./TemplateActions.js";

describe("TemplateActions", () => {
	it("renders a template download link with the download attribute", () => {
		render(<TemplateActions kind="persona" collection="personas" onUploaded={() => undefined} />);
		const link = screen.getByRole("link", { name: /download template/i });
		expect(link).toHaveAttribute("href", "/api/templates/persona");
		expect(link).toHaveAttribute("download", "PERSONA.md");
	});

	it("uploads a file: validates, saves under the document name and reports it", async () => {
		const put = vi.fn();
		server.use(
			http.put("*/api/scenarios/:name", async ({ request, params }) => {
				put({ name: params.name, body: await request.text() });
				return new HttpResponse(null, { status: 204 });
			}),
		);
		const onUploaded = vi.fn();
		render(<TemplateActions kind="scenario" collection="scenarios" onUploaded={onUploaded} />);
		const input = screen.getByLabelText(/upload file/i);
		const file = new File([fx.templates.scenario], "anything.yaml", { type: "text/yaml" });
		fireEvent.change(input, { target: { files: [file] } });
		await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("invoice-export-september"));
		expect(put.mock.calls[0]?.[0]).toMatchObject({ name: "invoice-export-september" });
		expect(put.mock.calls[0]?.[0].body).toBe(fx.templates.scenario);
	});

	it("shows validation issues instead of saving an invalid file", async () => {
		const put = vi.fn();
		server.use(
			http.put("*/api/scenarios/:name", () => {
				put();
				return new HttpResponse(null, { status: 204 });
			}),
		);
		const onUploaded = vi.fn();
		render(<TemplateActions kind="scenario" collection="scenarios" onUploaded={onUploaded} />);
		const file = new File(["name: broken\n"], "broken.yaml", { type: "text/yaml" });
		fireEvent.change(screen.getByLabelText(/upload file/i), { target: { files: [file] } });
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("goal");
		expect(put).not.toHaveBeenCalled();
		expect(onUploaded).not.toHaveBeenCalled();
	});
});
