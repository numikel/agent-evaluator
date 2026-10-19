import { describe, expect, it } from "vitest";
import { personaCodec } from "./persona.js";

const MARKDOWN = `---
name: impatient-smb-owner
description: Owner of a small business.
language: en
traits:
  - impatient
  - direct
interaction_style: []
version: 1
---

# Background

Marta runs a bakery.
`;

describe("persona codec", () => {
	it("splits frontmatter and body", () => {
		const result = personaCodec.parse(MARKDOWN);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error);
		expect(result.value.frontmatter).toEqual({
			name: "impatient-smb-owner",
			description: "Owner of a small business.",
			language: "en",
			traits: ["impatient", "direct"],
			interaction_style: [],
			version: 1,
		});
		expect(result.value.body).toBe("# Background\n\nMarta runs a bakery.\n");
	});

	it("round-trips through stringify", () => {
		const parsed = personaCodec.parse(MARKDOWN);
		if (!parsed.ok) throw new Error(parsed.error);
		expect(personaCodec.stringify(parsed.value)).toBe(MARKDOWN);
	});

	it("fails on a document without a frontmatter block", () => {
		const result = personaCodec.parse("# Just markdown\n");
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error).toMatch(/frontmatter/i);
	});

	it("fails on invalid frontmatter YAML", () => {
		const result = personaCodec.parse("---\nname: [oops\n---\nbody\n");
		expect(result.ok).toBe(false);
	});

	it("keeps an empty frontmatter block as an empty record", () => {
		const result = personaCodec.parse("---\n---\nbody\n");
		expect(result).toEqual({ ok: true, value: { frontmatter: {}, body: "body\n" } });
	});
});
