/**
 * Golden `ReportInput` fixtures used by the report tests (and handy for UI development).
 * Parsed through the schema so every fixture is guaranteed to be a valid input.
 */
import { type ReportInput, ReportInputSchema } from "../types.js";
import failedJson from "./failed-max-turns.json" with { type: "json" };
import passedJson from "./passed.json" with { type: "json" };

/** A PASSED run: 3 of 6 turns, one PDF download, every criterion passing. */
export const passedFixture = (): ReportInput => ReportInputSchema.parse(passedJson);

/** A FAILED run: turn budget exhausted, two required criteria failed, a bot message containing `<script>`. */
export const failedMaxTurnsFixture = (): ReportInput => ReportInputSchema.parse(failedJson);
