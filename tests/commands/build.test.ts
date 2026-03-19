import { describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { executeBuild } from "../../src/commands/build.ts";
import { isOk, unwrap } from "../../src/types/result.ts";

const FIXTURE_ROOT = "tests/fixtures/python-fastapi";
const TMP_LATTICE = `${FIXTURE_ROOT}/.lattice`;

function cleanup(): void {
	if (existsSync(TMP_LATTICE)) {
		rmSync(TMP_LATTICE, { recursive: true });
	}
}

describe("executeBuild", () => {
	it("builds the graph from a Python project", async () => {
		cleanup();

		const result = await executeBuild(FIXTURE_ROOT, {
			languages: ["python"],
			root: "src",
			exclude: ["__pycache__", ".git", "node_modules"],
			python: {
				sourceRoots: ["src"],
				testPaths: ["tests"],
			},
			typescript: undefined,
			lint: { strict: false, ignore: [] },
		});

		expect(isOk(result)).toBe(true);
		const stats = unwrap(result);
		expect(stats.fileCount).toBeGreaterThan(0);
		expect(stats.nodeCount).toBeGreaterThan(0);
		expect(stats.edgeCount).toBeGreaterThan(0);
		expect(stats.tagCount).toBeGreaterThan(0);

		cleanup();
	});

	it("creates .lattice/graph.db file", async () => {
		cleanup();

		await executeBuild(FIXTURE_ROOT, {
			languages: ["python"],
			root: "src",
			exclude: [],
			python: { sourceRoots: ["src"], testPaths: ["tests"] },
			typescript: undefined,
			lint: { strict: false, ignore: [] },
		});

		expect(existsSync(`${TMP_LATTICE}/graph.db`)).toBe(true);

		cleanup();
	});

	it("synthesizes event edges from emits/handles tags", async () => {
		cleanup();

		const result = await executeBuild(FIXTURE_ROOT, {
			languages: ["python"],
			root: "src",
			exclude: [],
			python: { sourceRoots: ["src"], testPaths: ["tests"] },
			typescript: undefined,
			lint: { strict: false, ignore: [] },
		});

		const stats = unwrap(result);
		expect(stats.eventEdgeCount).toBeGreaterThan(0);

		cleanup();
	});

	it("populates meta table with build metadata", async () => {
		cleanup();

		await executeBuild(FIXTURE_ROOT, {
			languages: ["python"],
			root: "src",
			exclude: [],
			python: { sourceRoots: ["src"], testPaths: ["tests"] },
			typescript: undefined,
			lint: { strict: false, ignore: [] },
		});

		const { Database } = await import("bun:sqlite");
		const db = new Database(`${TMP_LATTICE}/graph.db`, { readonly: true });
		const version = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as {
			value: string;
		};
		expect(version.value).toBe("1");

		const lastBuild = db.query("SELECT value FROM meta WHERE key = 'last_build'").get() as {
			value: string;
		};
		expect(lastBuild.value).toBeTruthy();
		db.close();

		cleanup();
	});

	it("is idempotent — building twice yields same result", async () => {
		cleanup();

		const config = {
			languages: ["python"] as readonly string[],
			root: "src",
			exclude: [] as readonly string[],
			python: {
				sourceRoots: ["src"] as readonly string[],
				testPaths: ["tests"] as readonly string[],
			},
			typescript: undefined,
			lint: {
				strict: false,
				ignore: [] as readonly string[],
				boundaryPackages: [] as readonly string[],
			},
		};

		const result1 = unwrap(await executeBuild(FIXTURE_ROOT, config));
		const result2 = unwrap(await executeBuild(FIXTURE_ROOT, config));

		expect(result1.nodeCount).toBe(result2.nodeCount);
		expect(result1.edgeCount).toBe(result2.edgeCount);
		expect(result1.tagCount).toBe(result2.tagCount);

		cleanup();
	});
});
