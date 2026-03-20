import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createDatabase } from "../../src/graph/database.ts";
import { buildGraph, buildLanguageConfig } from "../../src/lsp/builder.ts";

const FIXTURE_DIR = resolve(import.meta.dir, "../fixtures/py-simple");

describe("buildGraph — Python", () => {
	test("builds graph from Python files with pyright", async () => {
		const db = createDatabase(":memory:");
		const result = await buildGraph({
			projectRoot: FIXTURE_DIR,
			db,
			languageConfigs: [buildLanguageConfig("python", ["."], [], undefined)],
			exclude: ["__pycache__", ".git", "node_modules"],
		});

		expect(result.fileCount).toBeGreaterThan(0);
		expect(result.nodeCount).toBeGreaterThan(0);

		// Verify nodes were created
		const nodes = db.query("SELECT id, name, language FROM nodes ORDER BY name").all() as {
			id: string;
			name: string;
			language: string;
		}[];
		expect(nodes.length).toBeGreaterThan(0);
		expect(nodes.every((n) => n.language === "python")).toBe(true);

		const names = nodes.map((n) => n.name);
		expect(names).toContain("process_order");
		expect(names).toContain("save_order");

		// Verify tags
		const tags = db.query("SELECT * FROM tags ORDER BY kind").all() as {
			node_id: string;
			kind: string;
			value: string;
		}[];
		expect(tags).toHaveLength(2);

		db.close();
	}, 30000);

	test("detects cross-file call edges in Python", async () => {
		const db = createDatabase(":memory:");
		await buildGraph({
			projectRoot: FIXTURE_DIR,
			db,
			languageConfigs: [buildLanguageConfig("python", ["."], [], undefined)],
			exclude: ["__pycache__", ".git"],
		});

		// process_order calls save_order (cross-file)
		const edge = db
			.query(
				"SELECT * FROM edges WHERE source_id LIKE '%process_order' AND target_id LIKE '%save_order'",
			)
			.get();
		expect(edge).toBeTruthy();

		db.close();
	}, 30000);
});
