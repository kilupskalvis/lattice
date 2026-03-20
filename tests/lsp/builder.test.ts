import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createDatabase } from "../../src/graph/database.ts";
import { buildGraph } from "../../src/lsp/builder.ts";

const FIXTURE_DIR = resolve(import.meta.dir, "../fixtures/ts-cross-file");

describe("buildGraph", () => {
	test("builds graph with cross-file edges and tags", async () => {
		const db = createDatabase(":memory:");
		const result = await buildGraph({
			projectRoot: FIXTURE_DIR,
			db,
			languages: ["typescript"],
			sourceRoots: ["."],
			exclude: ["node_modules", ".git"],
			testPaths: [],
			lspCommand: undefined,
		});

		expect(result.fileCount).toBe(2);
		expect(result.nodeCount).toBeGreaterThan(0);
		expect(result.edgeCount).toBeGreaterThan(0);
		expect(result.tagCount).toBe(2);

		// Verify cross-file edge: processOrder -> save
		const edge = db
			.query("SELECT * FROM edges WHERE source_id LIKE '%processOrder' AND target_id LIKE '%save'")
			.get();
		expect(edge).toBeTruthy();

		// Verify tags
		const tags = db.query("SELECT * FROM tags ORDER BY kind").all() as {
			node_id: string;
			kind: string;
			value: string;
		}[];
		expect(tags).toHaveLength(2);
		const tagKinds = tags.map((t) => t.kind);
		expect(tagKinds).toContain("flow");
		expect(tagKinds).toContain("boundary");

		db.close();
	}, 30000);

	test("returns zero stats for empty project", async () => {
		const db = createDatabase(":memory:");
		const result = await buildGraph({
			projectRoot: "/nonexistent",
			db,
			languages: ["typescript"],
			sourceRoots: ["."],
			exclude: [],
			testPaths: [],
			lspCommand: undefined,
		});

		expect(result.fileCount).toBe(0);
		expect(result.nodeCount).toBe(0);
		db.close();
	}, 5000);
});
