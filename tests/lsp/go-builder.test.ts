import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { which } from "bun";
import { createDatabase } from "../../src/graph/database.ts";
import { buildGraph, buildLanguageConfig } from "../../src/lsp/builder.ts";

const FIXTURE_DIR = resolve(import.meta.dir, "../fixtures/go-simple");
const hasGopls = which("gopls") !== null;

describe.skipIf(!hasGopls)("buildGraph — Go", () => {
	test("builds graph from Go files with gopls", async () => {
		const db = createDatabase(":memory:");
		const result = await buildGraph({
			projectRoot: FIXTURE_DIR,
			db,
			languageConfigs: [buildLanguageConfig("go", ["."], [])],
			exclude: ["vendor", ".git"],
		});

		expect(result.fileCount).toBeGreaterThan(0);
		expect(result.nodeCount).toBeGreaterThan(0);

		const nodes = db.query("SELECT id, name, language FROM nodes ORDER BY name").all() as {
			id: string;
			name: string;
			language: string;
		}[];
		expect(nodes.length).toBeGreaterThan(0);
		expect(nodes.every((n) => n.language === "go")).toBe(true);

		const names = nodes.map((n) => n.name);
		expect(names).toContain("ProcessOrder");
		expect(names).toContain("SaveOrder");
		expect(names).toContain("validate");

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

	test("detects _test.go files as test nodes", async () => {
		const db = createDatabase(":memory:");
		await buildGraph({
			projectRoot: FIXTURE_DIR,
			db,
			languageConfigs: [buildLanguageConfig("go", ["."], [])],
			exclude: ["vendor", ".git"],
		});

		const testNodes = db.query("SELECT name, is_test FROM nodes WHERE is_test = 1").all() as {
			name: string;
			is_test: number;
		}[];
		expect(testNodes.length).toBeGreaterThan(0);
		expect(testNodes.some((n) => n.name === "TestProcessOrder")).toBe(true);

		db.close();
	}, 30000);

	test("detects cross-file call edges in Go", async () => {
		const db = createDatabase(":memory:");
		await buildGraph({
			projectRoot: FIXTURE_DIR,
			db,
			languageConfigs: [buildLanguageConfig("go", ["."], [])],
			exclude: ["vendor", ".git"],
		});

		const edge = db
			.query(
				"SELECT * FROM edges WHERE source_id LIKE '%ProcessOrder' AND target_id LIKE '%SaveOrder'",
			)
			.get();
		expect(edge).toBeTruthy();

		db.close();
	}, 30000);
});
