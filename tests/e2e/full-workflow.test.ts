import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { executeBuild } from "../../src/commands/build.ts";
import { executeLint } from "../../src/commands/lint.ts";
import {
	getAllBoundaries,
	getAllFlows,
	getCallers,
	getFlowMembers,
	resolveSymbol,
} from "../../src/graph/queries.ts";
import type { LatticeConfig } from "../../src/types/config.ts";
import { isOk } from "../../src/types/result.ts";

const TMP_DIR = resolve(import.meta.dir, "../fixtures/.tmp-e2e-test");
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

let db: Database;

beforeAll(async () => {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
	cpSync(FIXTURE_SRC, TMP_DIR, { recursive: true });

	const result = await executeBuild(TMP_DIR, config);
	expect(isOk(result)).toBe(true);

	db = new Database(join(TMP_DIR, ".lattice/graph.db"), { readonly: true });
}, 30000);

afterAll(() => {
	db?.close();
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

describe("E2E: build", () => {
	it("creates graph.db with nodes, edges, and tags", () => {
		const nodes = (db.query("SELECT COUNT(*) as c FROM nodes").get() as { c: number }).c;
		const edges = (db.query("SELECT COUNT(*) as c FROM edges").get() as { c: number }).c;
		const tags = (db.query("SELECT COUNT(*) as c FROM tags").get() as { c: number }).c;
		expect(nodes).toBeGreaterThan(0);
		expect(edges).toBeGreaterThan(0);
		expect(tags).toBeGreaterThan(0);
	});
});

describe("E2E: flows and boundaries", () => {
	it("shows process-order flow", () => {
		const flows = getAllFlows(db);
		const values = flows.map((f) => f.value);
		expect(values).toContain("process-order");
	});

	it("shows postgres boundary", () => {
		const boundaries = getAllBoundaries(db);
		const values = boundaries.map((b) => b.value);
		expect(values).toContain("postgres");
	});
});

describe("E2E: flow process-order", () => {
	it("includes processOrder and its callees", () => {
		const members = getFlowMembers(db, "process-order");
		const names = members.map((m) => m.name);
		expect(names).toContain("processOrder");
		expect(names).toContain("validate");
		expect(names).toContain("save");
	});
});

describe("E2E: context save", () => {
	it("shows callers and boundary", () => {
		const nodes = resolveSymbol(db, "save");
		expect(nodes.length).toBe(1);
		const node = nodes[0];
		if (!node) return;

		const callers = getCallers(db, node.id);
		expect(callers.map((c) => c.name)).toContain("processOrder");

		const allBoundaries = getAllBoundaries(db);
		const boundary = allBoundaries.find((b) => b.node.id === node.id)?.value;
		expect(boundary).toBe("postgres");
	});
});

describe("E2E: lint", () => {
	it("reports no errors for properly tagged fixture", () => {
		const result = executeLint(db, config);
		const errors = result.issues.filter((i) => i.severity === "error");
		expect(errors.length).toBe(0);
	});
});

describe("E2E: error cases", () => {
	it("returns empty for unknown flow", () => {
		const members = getFlowMembers(db, "nonexistent");
		expect(members.length).toBe(0);
	});

	it("returns empty for unknown symbol", () => {
		const nodes = resolveSymbol(db, "nonexistent_symbol_xyz");
		expect(nodes.length).toBe(0);
	});
});
