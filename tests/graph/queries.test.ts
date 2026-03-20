import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDatabase } from "../../src/graph/database.ts";
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
import {
	insertEdges,
	insertNodes,
	insertTags,
	synthesizeEventEdges,
} from "../../src/graph/writer.ts";
import type { Edge, Node, Tag } from "../../src/types/graph.ts";

function makeNode(overrides: Partial<Node> & { id: string; name: string }): Node {
	return {
		kind: "function",
		file: "src/test.py",
		lineStart: 1,
		lineEnd: 10,
		language: "python",
		signature: undefined,
		isTest: false,
		metadata: undefined,
		...overrides,
	};
}

/**
 * Builds a realistic test graph:
 *
 * [flow:checkout] handle_checkout → create_order → charge [boundary:stripe]
 *                                                → save_order [boundary:postgres]
 *                                                → emit_created [emits:order.created]
 *                                                       ↓ (event edge)
 *                                                  send_email [handles:order.created]
 *
 * Also: [flow:checkout] ts_submit (TypeScript, cross-language same flow)
 */
function buildTestGraph(db: Database): void {
	const nodes: Node[] = [
		makeNode({
			id: "src/routes.py::handle_checkout",
			name: "handle_checkout",
			file: "src/routes.py",
			lineStart: 12,
			lineEnd: 20,
			metadata: { route: "POST /api/checkout" },
		}),
		makeNode({
			id: "src/services.py::create_order",
			name: "create_order",
			file: "src/services.py",
			lineStart: 20,
			lineEnd: 40,
		}),
		makeNode({
			id: "src/gateways.py::charge",
			name: "charge",
			file: "src/gateways.py",
			lineStart: 23,
			lineEnd: 48,
			signature: "charge(amount: Decimal, token: str) -> PaymentResult",
		}),
		makeNode({
			id: "src/db.py::save_order",
			name: "save_order",
			file: "src/db.py",
			lineStart: 34,
			lineEnd: 40,
		}),
		makeNode({
			id: "src/services.py::emit_created",
			name: "emit_created",
			file: "src/services.py",
			lineStart: 42,
			lineEnd: 45,
		}),
		makeNode({
			id: "src/workers.py::send_email",
			name: "send_email",
			file: "src/workers.py",
			lineStart: 15,
			lineEnd: 25,
		}),
		makeNode({
			id: "src/frontend.ts::ts_submit",
			name: "ts_submit",
			file: "src/frontend.ts",
			language: "typescript",
			lineStart: 5,
			lineEnd: 15,
		}),
		makeNode({
			id: "tests/test_charge.py::test_charge",
			name: "test_charge",
			file: "tests/test_charge.py",
			isTest: true,
			lineStart: 1,
			lineEnd: 10,
		}),
	];

	const edges: Edge[] = [
		{
			sourceId: "src/routes.py::handle_checkout",
			targetId: "src/services.py::create_order",
			kind: "calls",
					},
		{
			sourceId: "src/services.py::create_order",
			targetId: "src/gateways.py::charge",
			kind: "calls",
					},
		{
			sourceId: "src/services.py::create_order",
			targetId: "src/db.py::save_order",
			kind: "calls",
					},
		{
			sourceId: "src/services.py::create_order",
			targetId: "src/services.py::emit_created",
			kind: "calls",
					},
		{
			sourceId: "tests/test_charge.py::test_charge",
			targetId: "src/gateways.py::charge",
			kind: "calls",
					},
	];

	const tags: Tag[] = [
		{ nodeId: "src/routes.py::handle_checkout", kind: "flow", value: "checkout" },
		{ nodeId: "src/frontend.ts::ts_submit", kind: "flow", value: "checkout" },
		{ nodeId: "src/gateways.py::charge", kind: "boundary", value: "stripe" },
		{ nodeId: "src/db.py::save_order", kind: "boundary", value: "postgres" },
		{ nodeId: "src/services.py::emit_created", kind: "emits", value: "order.created" },
		{ nodeId: "src/workers.py::send_email", kind: "handles", value: "order.created" },
	];

	insertNodes(db, nodes);
	insertEdges(db, edges);
	insertTags(db, tags);
	synthesizeEventEdges(db);
}

let db: Database;

beforeEach(() => {
	db = createDatabase(":memory:");
	buildTestGraph(db);
});

afterEach(() => {
	db.close();
});

describe("resolveSymbol", () => {
	it("resolves by full ID", () => {
		const results = resolveSymbol(db, "src/gateways.py::charge");
		expect(results.length).toBe(1);
		expect(results[0]?.name).toBe("charge");
	});

	it("resolves by short name when unambiguous", () => {
		const results = resolveSymbol(db, "charge");
		expect(results.length).toBe(1);
		expect(results[0]?.name).toBe("charge");
	});

	it("returns multiple matches for ambiguous names", () => {
		// Both handle_checkout and ts_submit exist, but let's test with a non-ambiguous case
		// Add a duplicate name scenario
		insertNodes(db, [makeNode({ id: "other.py::charge", name: "charge", file: "other.py" })]);
		const results = resolveSymbol(db, "charge");
		expect(results.length).toBe(2);
	});

	it("returns empty for unknown symbol", () => {
		const results = resolveSymbol(db, "nonexistent");
		expect(results.length).toBe(0);
	});
});

describe("getFlowMembers", () => {
	it("returns all nodes in a flow via call graph traversal", () => {
		const members = getFlowMembers(db, "checkout");
		const names = members.map((m) => m.name);
		expect(names).toContain("handle_checkout");
		expect(names).toContain("create_order");
		expect(names).toContain("charge");
		expect(names).toContain("save_order");
		expect(names).toContain("emit_created");
	});

	it("traverses event edges into handlers", () => {
		const members = getFlowMembers(db, "checkout");
		const names = members.map((m) => m.name);
		expect(names).toContain("send_email");
	});

	it("includes cross-language entry points with the same flow tag", () => {
		const members = getFlowMembers(db, "checkout");
		const names = members.map((m) => m.name);
		expect(names).toContain("ts_submit");
	});

	it("returns empty for unknown flow", () => {
		const members = getFlowMembers(db, "nonexistent");
		expect(members.length).toBe(0);
	});
});

describe("getCallers", () => {
	it("returns direct callers of a node", () => {
		const callers = getCallers(db, "src/gateways.py::charge");
		const names = callers.map((c) => c.name);
		expect(names).toContain("create_order");
		expect(names).toContain("test_charge");
	});

	it("returns empty for node with no callers", () => {
		const callers = getCallers(db, "src/routes.py::handle_checkout");
		expect(callers.length).toBe(0);
	});
});

describe("getCallees", () => {
	it("returns direct callees of a node", () => {
		const callees = getCallees(db, "src/services.py::create_order");
		const names = callees.map((c) => c.name);
		expect(names).toContain("charge");
		expect(names).toContain("save_order");
		expect(names).toContain("emit_created");
	});

	it("returns empty for leaf node", () => {
		const callees = getCallees(db, "src/gateways.py::charge");
		expect(callees.length).toBe(0);
	});
});

describe("getImpact", () => {
	it("returns transitive callers up to flow entry points", () => {
		const impact = getImpact(db, "src/gateways.py::charge");
		const names = impact.map((n) => n.name);
		expect(names).toContain("create_order");
		expect(names).toContain("handle_checkout");
		expect(names).toContain("test_charge");
	});

	it("returns empty for entry point with no callers", () => {
		const impact = getImpact(db, "src/routes.py::handle_checkout");
		expect(impact.length).toBe(0);
	});
});

describe("getFlowsForNode", () => {
	it("returns derived flow membership for an intermediate node", () => {
		const flows = getFlowsForNode(db, "src/gateways.py::charge");
		expect(flows).toContain("checkout");
	});

	it("returns direct flow tag for entry point", () => {
		const flows = getFlowsForNode(db, "src/routes.py::handle_checkout");
		expect(flows).toContain("checkout");
	});

	it("returns empty for node not in any flow", () => {
		insertNodes(db, [makeNode({ id: "orphan.py::orphan", name: "orphan", file: "orphan.py" })]);
		const flows = getFlowsForNode(db, "orphan.py::orphan");
		expect(flows.length).toBe(0);
	});
});

describe("getAllFlows", () => {
	it("returns all flow entry points", () => {
		const flows = getAllFlows(db);
		expect(flows.length).toBe(2);
		const names = flows.map((f) => f.value);
		expect(names).toContain("checkout");
	});
});

describe("getAllBoundaries", () => {
	it("returns all boundary-tagged nodes", () => {
		const boundaries = getAllBoundaries(db);
		expect(boundaries.length).toBe(2);
		const values = boundaries.map((b) => b.value);
		expect(values).toContain("stripe");
		expect(values).toContain("postgres");
	});
});

describe("getAllEvents", () => {
	it("returns all emits-handles connections", () => {
		const events = getAllEvents(db);
		expect(events.length).toBe(1);
		expect(events[0]?.eventName).toBe("order.created");
		expect(events[0]?.emitterName).toBe("emit_created");
		expect(events[0]?.handlerName).toBe("send_email");
	});
});

describe("findAllPaths", () => {
	it("finds path from flow entry to boundary", () => {
		const paths = findAllPaths(db, "src/routes.py::handle_checkout", "src/gateways.py::charge");
		expect(paths.length).toBeGreaterThan(0);
		const firstPath = paths[0];
		expect(firstPath).toBeDefined();
		expect(firstPath?.[0]).toBe("src/routes.py::handle_checkout");
		expect(firstPath?.[firstPath.length - 1]).toBe("src/gateways.py::charge");
	});

	it("returns empty when no path exists", () => {
		const paths = findAllPaths(db, "src/workers.py::send_email", "src/routes.py::handle_checkout");
		expect(paths.length).toBe(0);
	});

	it("finds paths across event edges", () => {
		const paths = findAllPaths(db, "src/routes.py::handle_checkout", "src/workers.py::send_email");
		expect(paths.length).toBeGreaterThan(0);
	});

	it("handles cycles without infinite loop", () => {
		// Add a cycle: charge -> handle_checkout
		insertEdges(db, [
			{
				sourceId: "src/gateways.py::charge",
				targetId: "src/routes.py::handle_checkout",
				kind: "calls",
							},
		]);
		const paths = findAllPaths(db, "src/routes.py::handle_checkout", "src/gateways.py::charge");
		expect(paths.length).toBeGreaterThan(0);
	});
});

describe("empty database", () => {
	it("all queries return empty results on empty db", () => {
		const emptyDb = createDatabase(":memory:");
		expect(resolveSymbol(emptyDb, "anything").length).toBe(0);
		expect(getFlowMembers(emptyDb, "anything").length).toBe(0);
		expect(getCallers(emptyDb, "anything").length).toBe(0);
		expect(getCallees(emptyDb, "anything").length).toBe(0);
		expect(getImpact(emptyDb, "anything").length).toBe(0);
		expect(getFlowsForNode(emptyDb, "anything").length).toBe(0);
		expect(getAllFlows(emptyDb).length).toBe(0);
		expect(getAllBoundaries(emptyDb).length).toBe(0);
		expect(getAllEvents(emptyDb).length).toBe(0);
		expect(findAllPaths(emptyDb, "a", "b").length).toBe(0);
		emptyDb.close();
	});
});
