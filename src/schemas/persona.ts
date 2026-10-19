import { z } from "zod";
import { SlugSchema } from "./common.js";

/** YAML frontmatter of `personas/<name>.md`. The Markdown body holds the free-form description. */
export const PersonaFrontmatterSchema = z.object({
	name: SlugSchema,
	description: z.string().min(1).max(1024),
	/** BCP-47-ish language tag the persona speaks in (e.g. `en`, `pl`). */
	language: z.string().min(2).max(16).default("en"),
	/** Short adjectives, e.g. `impatient`, `non-technical`. */
	traits: z.array(z.string().min(1)).default([]),
	/** Behavioural modifiers applied by the simulator, e.g. `short-messages`, `occasional-typos`. */
	interaction_style: z.array(z.string().min(1)).default([]),
	version: z.number().int().positive().default(1),
});
export type PersonaFrontmatter = z.output<typeof PersonaFrontmatterSchema>;

/** Parsed persona: frontmatter + Markdown body (everything after the closing `---`). */
export const PersonaSchema = z.object({
	frontmatter: PersonaFrontmatterSchema,
	body: z.string(),
	/** Absolute or workspace-relative path of the source file, when loaded from disk. */
	path: z.string().optional(),
});
export type Persona = z.output<typeof PersonaSchema>;
