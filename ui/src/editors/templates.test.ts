import { describe, expect, it } from "vitest";
import { documentName, renameDocument, slugFromFilename } from "./templates.js";

describe("template helpers", () => {
	it("replaces the first top-level name in a YAML document", () => {
		const text = "# comment\nname: old-name\npersona: old-name\n";
		expect(renameDocument(text, "fresh")).toBe("# comment\nname: fresh\npersona: old-name\n");
	});

	it("replaces the name inside persona frontmatter", () => {
		const text = "---\nname: old\ndescription: x\n---\n\n# Body\nname: not this\n";
		expect(renameDocument(text, "fresh")).toBe(
			"---\nname: fresh\ndescription: x\n---\n\n# Body\nname: not this\n",
		);
	});

	it("prepends a name when the document has none", () => {
		expect(renameDocument("goal: x\n", "fresh")).toBe("name: fresh\ngoal: x\n");
	});

	it("reads the document name from YAML and from persona frontmatter", () => {
		expect(documentName("persona", "---\nname: marta\n---\nbody")).toBe("marta");
		expect(documentName("scenario", "name: invoice\ngoal: x\n")).toBe("invoice");
		expect(documentName("scenario", "goal: x\n")).toBeUndefined();
		expect(documentName("scenario", "name: [bad\n")).toBeUndefined();
	});

	it("derives a slug from a file name", () => {
		expect(slugFromFilename("My Persona (v2).md")).toBe("my-persona-v2");
		expect(slugFromFilename("scenario.yaml")).toBe("scenario");
		expect(slugFromFilename("...")).toBe("");
	});
});
