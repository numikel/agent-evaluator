/**
 * Report renderers (P5): pure functions from run artifacts to `report.html`, `summary.json`
 * and `junit.xml`. Consumed by the runner (P10) and the CLI (P11).
 */
import { renderHtml } from "./html.js";
import { renderJUnit } from "./junit.js";
import { renderSummary } from "./summary.js";
import type { RenderHtmlOptions, ReportFiles, ReportInput } from "./types.js";

export { actionLabel, renderHtml } from "./html.js";
export { renderJUnit, runFailureReason } from "./junit.js";
export { overallStatus, renderSummary } from "./summary.js";
export type {
	ImageLoader,
	RenderHtmlOptions,
	ReportFiles,
	ReportInput,
	ReportSummary,
} from "./types.js";
export { ReportInputSchema } from "./types.js";

/** Renders all three report files in the shape `RunStore.saveReport` expects. */
export async function renderReport(
	input: ReportInput,
	options: RenderHtmlOptions = {},
): Promise<ReportFiles> {
	return {
		"report.html": await renderHtml(input, options),
		"summary.json": `${JSON.stringify(renderSummary(input), null, 2)}\n`,
		"junit.xml": renderJUnit(input),
	};
}
