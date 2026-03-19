import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeBuild } from "../../src/commands/build.ts";
import { executeLint } from "../../src/commands/lint.ts";
import { executePopulate } from "../../src/commands/populate.ts";
import {
	findAllPaths,
	getAllBoundaries,
	getAllEvents,
	getAllFlows,
	getCallees,
	getCallers,
	getFlowMembers,
	getFlowsForNode,
	getImpact,
	resolveSymbol,
} from "../../src/graph/queries.ts";
import { formatContextJson, formatOverviewJson } from "../../src/output/json.ts";
import { formatContext, formatOverview } from "../../src/output/text.ts";
import type { LatticeConfig } from "../../src/types/config.ts";
import { isOk } from "../../src/types/result.ts";

const TMP_DIR = "tests/fixtures/.tmp-e2e-test";
const FIXTURE_SRC = "tests/fixtures/python-fastapi";

const config: LatticeConfig = {
	languages: ["python"],
	root: "src",
	exclude: [],
	python: { sourceRoots: ["src"], testPaths: ["tests"], frameworks: ["fastapi"] },
	typescript: undefined,
	lint: { strict: false, ignore: [] },
};

let db: Database;

beforeAll(async () => {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
	cpSync(FIXTURE_SRC, TMP_DIR, { recursive: true });

	// Write config
	writeFileSync(
		join(TMP_DIR, "lattice.toml"),
		`[project]
languages = ["python"]
root = "src"
exclude = []

[python]
source_roots = ["src"]
test_paths = ["tests"]
frameworks = ["fastapi"]

[lint]
strict = false
ignore = []

[lint.boundaries]
packages = ["stripe", "psycopg2"]
`,
	);

	// Build
	const result = await executeBuild(TMP_DIR, config);
	expect(isOk(result)).toBe(true);

	// Open DB for all query tests
	db = new Database(join(TMP_DIR, ".lattice/graph.db"), { readonly: true });
});

afterAll(() => {
	db.close();
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

describe("E2E: overview", () => {
	it("shows flows, boundaries, and events", () => {
		const flows = getAllFlows(db);
		const boundaries = getAllBoundaries(db);
		const events = getAllEvents(db);
		const output = formatOverview(flows, boundaries, events);

		expect(output).toContain("checkout");
		expect(output).toContain("stripe");
		expect(output).toContain("postgres");
		expect(output).toContain("order.created");
	});
});

describe("E2E: flow checkout", () => {
	it("shows full call tree with boundaries and events", () => {
		const members = getFlowMembers(db, "checkout");
		expect(members.length).toBeGreaterThan(3);

		const names = members.map((m) => m.name);
		expect(names).toContain("handle_checkout");
		expect(names).toContain("create_order");
		expect(names).toContain("charge");
		expect(names).toContain("save_order");
		// Event propagation should include send_confirmation
		expect(names).toContain("send_confirmation");
	});
});

describe("E2E: context charge", () => {
	it("shows callers, callees, flows, and boundary", () => {
		const nodes = resolveSymbol(db, "charge");
		expect(nodes.length).toBe(1);
		const node = nodes[0];
		expect(node).toBeDefined();
		if (!node) return;

		const callers = getCallers(db, node.id);
		const callees = getCallees(db, node.id);
		const flows = getFlowsForNode(db, node.id);
		const allBoundaries = getAllBoundaries(db);
		const boundary = allBoundaries.find((b) => b.node.id === node.id)?.value;

		expect(callers.map((c) => c.name)).toContain("create_order");
		expect(flows).toContain("checkout");
		expect(boundary).toBe("stripe");

		const output = formatContext({
			node,
			flows: [...flows],
			callers: [...callers],
			callees: [...callees],
			boundary,
		});
		expect(output).toContain("charge");
		expect(output).toContain("stripe");
	});
});

describe("E2E: callers and callees", () => {
	it("returns callers for charge", () => {
		const nodes = resolveSymbol(db, "charge");
		const callers = getCallers(db, nodes[0]?.id ?? "");
		expect(callers.length).toBeGreaterThan(0);
	});

	it("returns callees for create_order", () => {
		const nodes = resolveSymbol(db, "create_order");
		const callees = getCallees(db, nodes[0]?.id ?? "");
		expect(callees.length).toBeGreaterThan(0);
	});
});

describe("E2E: trace checkout --to stripe", () => {
	it("finds path from checkout entry to stripe boundary", () => {
		const flows = getAllFlows(db);
		const entry = flows.find((f) => f.value === "checkout");
		expect(entry).toBeDefined();
		if (!entry) return;

		const boundaries = getAllBoundaries(db);
		const target = boundaries.find((b) => b.value === "stripe");
		expect(target).toBeDefined();
		if (!target) return;

		const paths = findAllPaths(db, entry.node.id, target.node.id);
		expect(paths.length).toBeGreaterThan(0);
	});
});

describe("E2E: impact charge", () => {
	it("shows affected flows and callers", () => {
		const nodes = resolveSymbol(db, "charge");
		const node = nodes[0];
		expect(node).toBeDefined();
		if (!node) return;

		const impact = getImpact(db, node.id);
		const impactNames = impact.map((n) => n.name);
		expect(impactNames).toContain("create_order");
		expect(impactNames).toContain("handle_checkout");

		const affectedFlows = [...new Set(impact.flatMap((n) => [...getFlowsForNode(db, n.id)]))];
		expect(affectedFlows).toContain("checkout");
	});
});

describe("E2E: boundaries", () => {
	it("lists stripe and postgres", () => {
		const boundaries = getAllBoundaries(db);
		const values = boundaries.map((b) => b.value);
		expect(values).toContain("stripe");
		expect(values).toContain("postgres");
	});
});

describe("E2E: events", () => {
	it("shows order.created connection", () => {
		const events = getAllEvents(db);
		expect(events.length).toBeGreaterThan(0);
		expect(events[0]?.eventName).toBe("order.created");
	});
});

describe("E2E: code charge", () => {
	it("returns function source with boundary tag", () => {
		const nodes = resolveSymbol(db, "charge");
		const node = nodes[0];
		expect(node).toBeDefined();
		if (!node) return;

		const fullPath = join(TMP_DIR, node.file);
		const source = Bun.file(fullPath).text();
		expect(source).resolves.toContain("@lattice:boundary stripe");
		expect(source).resolves.toContain("def charge");
	});
});

describe("E2E: lint", () => {
	it("reports no errors for properly tagged fixture", () => {
		const result = executeLint(db, config);
		const errors = result.issues.filter((i) => i.severity === "error");
		// The fixture is properly tagged, so no errors for tagged functions
		// (there may be warnings for stale tags or other non-critical issues)
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

	it("returns no path for unreachable trace", () => {
		const paths = findAllPaths(
			db,
			"src/workers/email.py::send_confirmation",
			"src/routes/checkout.py::handle_checkout",
		);
		expect(paths.length).toBe(0);
	});
});

describe("E2E: JSON output", () => {
	it("produces valid JSON for overview", () => {
		const flows = getAllFlows(db);
		const boundaries = getAllBoundaries(db);
		const events = getAllEvents(db);
		const json = formatOverviewJson(flows, boundaries, events);
		const parsed = JSON.parse(json);
		expect(parsed.flows.length).toBeGreaterThan(0);
		expect(parsed.boundaries.length).toBeGreaterThan(0);
	});

	it("produces valid JSON for context", () => {
		const nodes = resolveSymbol(db, "charge");
		const node = nodes[0];
		if (!node) return;
		const callers = getCallers(db, node.id);
		const callees = getCallees(db, node.id);
		const flows = getFlowsForNode(db, node.id);
		const json = formatContextJson({
			node,
			flows: [...flows],
			callers: [...callers],
			callees: [...callees],
			boundary: "stripe",
		});
		const parsed = JSON.parse(json);
		expect(parsed.name).toBe("charge");
		expect(parsed.boundary).toBe("stripe");
	});
});

describe("E2E: populate", () => {
	it("generates agent instructions", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("@lattice:flow");
		expect(output).toContain("lattice build");
	});
});
