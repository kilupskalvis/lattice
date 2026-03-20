import { describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { executeBuild } from "../../src/commands/build.ts";
import { isOk, unwrap } from "../../src/types/result.ts";

const FIXTURE_ROOT = resolve(import.meta.dir, "../fixtures/ts-cross-file");
const TMP_LATTICE = `${FIXTURE_ROOT}/.lattice`;

function cleanup(): void {
	if (existsSync(TMP_LATTICE)) {
		rmSync(TMP_LATTICE, { recursive: true });
	}
}

describe("executeBuild", () => {
	it("builds the graph from a TypeScript project via LSP", async () => {
		cleanup();

		const result = await executeBuild(FIXTURE_ROOT, {
			languages: ["typescript"],
			root: ".",
			exclude: ["node_modules", ".git"],
			python: undefined,
			typescript: {
				sourceRoots: ["."],
				testPaths: [],
				tsconfig: undefined,
				lspCommand: undefined,
			},
			lint: { strict: false, ignore: [] },
		});

		expect(isOk(result)).toBe(true);
		const stats = unwrap(result);
		expect(stats.fileCount).toBe(2);
		expect(stats.nodeCount).toBeGreaterThan(0);
		expect(stats.edgeCount).toBeGreaterThan(0);
		expect(stats.tagCount).toBe(2);

		cleanup();
	}, 30000);

	it("creates .lattice/graph.db file", async () => {
		cleanup();

		await executeBuild(FIXTURE_ROOT, {
			languages: ["typescript"],
			root: ".",
			exclude: ["node_modules"],
			python: undefined,
			typescript: {
				sourceRoots: ["."],
				testPaths: [],
				tsconfig: undefined,
				lspCommand: undefined,
			},
			lint: { strict: false, ignore: [] },
		});

		expect(existsSync(`${TMP_LATTICE}/graph.db`)).toBe(true);

		cleanup();
	}, 30000);

	it("populates meta table with build metadata", async () => {
		cleanup();

		await executeBuild(FIXTURE_ROOT, {
			languages: ["typescript"],
			root: ".",
			exclude: ["node_modules"],
			python: undefined,
			typescript: {
				sourceRoots: ["."],
				testPaths: [],
				tsconfig: undefined,
				lspCommand: undefined,
			},
			lint: { strict: false, ignore: [] },
		});

		const { Database } = await import("bun:sqlite");
		const db = new Database(`${TMP_LATTICE}/graph.db`, { readonly: true });
		const version = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as {
			value: string;
		};
		expect(version.value).toBe("2");

		const lastBuild = db.query("SELECT value FROM meta WHERE key = 'last_build'").get() as {
			value: string;
		};
		expect(lastBuild.value).toBeTruthy();
		db.close();

		cleanup();
	}, 30000);
});
