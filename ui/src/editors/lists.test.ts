import { describe, expect, it } from "vitest";
import { joinCommaList, joinLines, splitCommaList, splitLines, stringList } from "./lists.js";

describe("list helpers", () => {
	it("splits comma lists and trims blanks", () => {
		expect(splitCommaList(" impatient, direct ,, ")).toEqual(["impatient", "direct"]);
		expect(splitCommaList("")).toEqual([]);
	});

	it("joins comma lists with a space", () => {
		expect(joinCommaList(["a", "b"])).toBe("a, b");
	});

	it("splits lines and drops empty ones", () => {
		expect(splitLines("first\n\n  second  \n")).toEqual(["first", "second"]);
	});

	it("joins lines", () => {
		expect(joinLines(["a", "b"])).toBe("a\nb");
	});

	it("coerces unknown values to a string list", () => {
		expect(stringList(["a", 1, null])).toEqual(["a", "1"]);
		expect(stringList("single")).toEqual(["single"]);
		expect(stringList(undefined)).toEqual([]);
	});
});
