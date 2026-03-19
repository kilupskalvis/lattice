import { describe, expect, it } from "bun:test";
import { parseTags } from "../../src/extract/tags.ts";
import { isErr, isOk, unwrap } from "../../src/types/result.ts";

describe("parseTags", () => {
	it("parses a Python flow tag", () => {
		const result = parseTags("# @lattice:flow checkout");
		expect(isOk(result)).toBe(true);
		const tags = unwrap(result);
		expect(tags.length).toBe(1);
		expect(tags[0]?.kind).toBe("flow");
		expect(tags[0]?.value).toBe("checkout");
	});

	it("parses a TypeScript boundary tag", () => {
		const result = parseTags("// @lattice:boundary stripe");
		expect(isOk(result)).toBe(true);
		const tags = unwrap(result);
		expect(tags.length).toBe(1);
		expect(tags[0]?.kind).toBe("boundary");
		expect(tags[0]?.value).toBe("stripe");
	});

	it("parses emits tag", () => {
		const result = parseTags("# @lattice:emits order.created");
		expect(isOk(result)).toBe(true);
		const tags = unwrap(result);
		expect(tags.length).toBe(1);
		expect(tags[0]?.kind).toBe("emits");
		expect(tags[0]?.value).toBe("order.created");
	});

	it("parses handles tag", () => {
		const result = parseTags("# @lattice:handles order.created");
		expect(isOk(result)).toBe(true);
		const tags = unwrap(result);
		expect(tags.length).toBe(1);
		expect(tags[0]?.kind).toBe("handles");
		expect(tags[0]?.value).toBe("order.created");
	});

	it("parses comma-separated multiple values", () => {
		const result = parseTags("# @lattice:flow checkout, payment");
		expect(isOk(result)).toBe(true);
		const tags = unwrap(result);
		expect(tags.length).toBe(2);
		expect(tags[0]?.value).toBe("checkout");
		expect(tags[1]?.value).toBe("payment");
	});

	it("parses multiple tag lines in a comment block", () => {
		const block = "# @lattice:flow checkout\n# @lattice:boundary stripe";
		const result = parseTags(block);
		expect(isOk(result)).toBe(true);
		const tags = unwrap(result);
		expect(tags.length).toBe(2);
		expect(tags[0]?.kind).toBe("flow");
		expect(tags[1]?.kind).toBe("boundary");
	});

	it("parses block comment style", () => {
		const result = parseTags("/* @lattice:flow checkout */");
		expect(isOk(result)).toBe(true);
		const tags = unwrap(result);
		expect(tags.length).toBe(1);
		expect(tags[0]?.value).toBe("checkout");
	});

	it("parses SQL-style comment", () => {
		const result = parseTags("-- @lattice:boundary postgres");
		expect(isOk(result)).toBe(true);
		const tags = unwrap(result);
		expect(tags.length).toBe(1);
		expect(tags[0]?.value).toBe("postgres");
	});

	it("ignores lines without lattice tags", () => {
		const block = "# just a regular comment\n# @lattice:flow checkout\n# another comment";
		const result = parseTags(block);
		expect(isOk(result)).toBe(true);
		const tags = unwrap(result);
		expect(tags.length).toBe(1);
	});

	it("returns empty for no tags found", () => {
		const result = parseTags("# just a regular comment");
		expect(isOk(result)).toBe(true);
		const tags = unwrap(result);
		expect(tags.length).toBe(0);
	});

	it("returns empty for empty string", () => {
		const result = parseTags("");
		expect(isOk(result)).toBe(true);
		expect(unwrap(result).length).toBe(0);
	});

	it("ignores unknown tag kinds", () => {
		const result = parseTags("# @lattice:invalid foo");
		expect(isOk(result)).toBe(true);
		expect(unwrap(result).length).toBe(0);
	});

	it("returns error for invalid name with spaces", () => {
		const result = parseTags("# @lattice:flow Invalid Name");
		expect(isErr(result)).toBe(true);
	});

	it("returns error for name starting with hyphen", () => {
		const result = parseTags("# @lattice:flow -bad-name");
		expect(isErr(result)).toBe(true);
	});

	it("accepts kebab-case names", () => {
		const result = parseTags("# @lattice:flow user-registration");
		expect(isOk(result)).toBe(true);
		expect(unwrap(result)[0]?.value).toBe("user-registration");
	});

	it("accepts dot-notation names for events", () => {
		const result = parseTags("# @lattice:emits order.item.created");
		expect(isOk(result)).toBe(true);
		expect(unwrap(result)[0]?.value).toBe("order.item.created");
	});

	it("trims whitespace around values", () => {
		const result = parseTags("# @lattice:flow  checkout , payment ");
		expect(isOk(result)).toBe(true);
		const tags = unwrap(result);
		expect(tags[0]?.value).toBe("checkout");
		expect(tags[1]?.value).toBe("payment");
	});
});
