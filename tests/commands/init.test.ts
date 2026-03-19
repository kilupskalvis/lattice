import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeInit } from "../../src/commands/init.ts";
import { isOk } from "../../src/types/result.ts";

const TMP_DIR = "tests/fixtures/.tmp-init-test";

function cleanup(): void {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
}

function setup(): void {
	cleanup();
	mkdirSync(TMP_DIR, { recursive: true });
}

describe("executeInit", () => {
	it("creates .lattice directory", () => {
		setup();
		const result = executeInit(TMP_DIR);
		expect(isOk(result)).toBe(true);
		expect(existsSync(join(TMP_DIR, ".lattice"))).toBe(true);
		cleanup();
	});

	it("creates lattice.toml with detected Python", () => {
		setup();
		mkdirSync(join(TMP_DIR, "src"), { recursive: true });
		writeFileSync(join(TMP_DIR, "src/main.py"), "def main(): pass");

		executeInit(TMP_DIR);

		const toml = Bun.file(join(TMP_DIR, "lattice.toml")).text();
		expect(toml).resolves.toContain('languages = ["python"]');
		cleanup();
	});

	it("creates lattice.toml with detected TypeScript", () => {
		setup();
		mkdirSync(join(TMP_DIR, "src"), { recursive: true });
		writeFileSync(join(TMP_DIR, "src/index.ts"), "export const x = 1;");

		executeInit(TMP_DIR);

		const toml = Bun.file(join(TMP_DIR, "lattice.toml")).text();
		expect(toml).resolves.toContain("typescript");
		cleanup();
	});

	it("does not overwrite existing lattice.toml", () => {
		setup();
		const tomlPath = join(TMP_DIR, "lattice.toml");
		writeFileSync(tomlPath, "# custom config\n[project]\nlanguages = ['python']");

		executeInit(TMP_DIR);

		const content = Bun.file(tomlPath).text();
		expect(content).resolves.toContain("# custom config");
		cleanup();
	});

	it("detects both Python and TypeScript", () => {
		setup();
		mkdirSync(join(TMP_DIR, "src"), { recursive: true });
		writeFileSync(join(TMP_DIR, "src/main.py"), "pass");
		writeFileSync(join(TMP_DIR, "src/app.ts"), "export {}");

		executeInit(TMP_DIR);

		const toml = Bun.file(join(TMP_DIR, "lattice.toml")).text();
		expect(toml).resolves.toContain("python");
		expect(toml).resolves.toContain("typescript");
		cleanup();
	});

	it("sets root to src when src/ directory exists", () => {
		setup();
		mkdirSync(join(TMP_DIR, "src"), { recursive: true });
		writeFileSync(join(TMP_DIR, "src/app.ts"), "export {}");

		executeInit(TMP_DIR);

		const toml = Bun.file(join(TMP_DIR, "lattice.toml")).text();
		expect(toml).resolves.toContain('root = "src"');
		cleanup();
	});

	it("sets root to . when no src/ directory", () => {
		setup();
		writeFileSync(join(TMP_DIR, "app.ts"), "export {}");

		executeInit(TMP_DIR);

		const toml = Bun.file(join(TMP_DIR, "lattice.toml")).text();
		expect(toml).resolves.toContain('root = "."');
		cleanup();
	});

	it("ignores test and fixture directories for language detection", () => {
		setup();
		mkdirSync(join(TMP_DIR, "src"), { recursive: true });
		mkdirSync(join(TMP_DIR, "tests/fixtures/python-app"), { recursive: true });
		writeFileSync(join(TMP_DIR, "src/app.ts"), "export {}");
		writeFileSync(join(TMP_DIR, "tests/fixtures/python-app/main.py"), "pass");

		executeInit(TMP_DIR);

		const toml = Bun.file(join(TMP_DIR, "lattice.toml")).text();
		// Should detect only TypeScript, not Python from fixtures
		expect(toml).resolves.toContain("typescript");
		expect(toml).resolves.not.toContain("python");
		cleanup();
	});
});
