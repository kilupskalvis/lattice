import { describe, expect, it } from "bun:test";
import { parseConfig } from "../src/config.ts";
import { isErr, isOk, unwrap } from "../src/types/result.ts";

describe("parseConfig", () => {
	it("parses a valid config file", async () => {
		const toml = await Bun.file("tests/fixtures/valid-lattice.toml").text();
		const result = parseConfig(toml);
		expect(isOk(result)).toBe(true);
		const config = unwrap(result);
		expect(config.languages).toEqual(["python"]);
		expect(config.root).toBe("src");
		expect(config.python?.frameworks).toEqual(["fastapi"]);
	});

	it("applies defaults for missing optional fields", async () => {
		const toml = await Bun.file("tests/fixtures/minimal-lattice.toml").text();
		const result = parseConfig(toml);
		expect(isOk(result)).toBe(true);
		const config = unwrap(result);
		expect(config.root).toBe(".");
		expect(config.exclude).toContain("node_modules");
		expect(config.lint.strict).toBe(false);
		expect(config.lint.ignore).toEqual([]);
	});

	it("returns error for missing languages", () => {
		const result = parseConfig("[project]\n");
		expect(isErr(result)).toBe(true);
	});

	it("returns error for empty languages array", () => {
		const result = parseConfig("[project]\nlanguages = []");
		expect(isErr(result)).toBe(true);
	});

	it("returns error for invalid TOML", () => {
		const result = parseConfig("not valid toml {{{");
		expect(isErr(result)).toBe(true);
	});

	it("parses python section when present", async () => {
		const toml = await Bun.file("tests/fixtures/valid-lattice.toml").text();
		const config = unwrap(parseConfig(toml));
		expect(config.python).toBeDefined();
		expect(config.python?.sourceRoots).toEqual(["src"]);
		expect(config.python?.testPaths).toEqual(["tests"]);
	});

	it("leaves python undefined when not in languages", () => {
		const toml = '[project]\nlanguages = ["typescript"]';
		const config = unwrap(parseConfig(toml));
		expect(config.python).toBeUndefined();
	});
});
