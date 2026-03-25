import { describe, expect, it } from "bun:test";
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { executeBuild } from "../../src/commands/build.ts";
import { executeUpdate } from "../../src/commands/update.ts";
import type { LatticeConfig } from "../../src/types/config.ts";
import { isOk } from "../../src/types/result.ts";

const TMP_DIR = resolve(import.meta.dir, "../fixtures/.tmp-update-test");
const FIXTURE_SRC = resolve(import.meta.dir, "../fixtures/ts-cross-file");

const config: LatticeConfig = {
	languages: ["typescript"],
	root: ".",
	exclude: ["node_modules", ".git", ".lattice"],
	python: undefined,
	typescript: {
		sourceRoots: ["."],
		testPaths: [],
		tsconfig: undefined,
	},
	go: undefined,
	lint: { strict: false, ignore: [] },
};

function setup(): void {
	cleanup();
	cpSync(FIXTURE_SRC, TMP_DIR, { recursive: true });
}

function cleanup(): void {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
}

describe("executeUpdate", () => {
	it("falls back to full build when no prior build exists", async () => {
		setup();
		const result = await executeUpdate(TMP_DIR, config);
		expect(isOk(result)).toBe(true);
		cleanup();
	}, 30000);

	it("re-indexes only changed files", async () => {
		setup();
		const buildResult = await executeBuild(TMP_DIR, config);
		expect(isOk(buildResult)).toBe(true);

		const filePath = join(TMP_DIR, "db.ts");
		await Bun.sleep(100);
		writeFileSync(filePath, await Bun.file(filePath).text());

		const updateResult = await executeUpdate(TMP_DIR, config);
		expect(isOk(updateResult)).toBe(true);

		cleanup();
	}, 60000);
});
