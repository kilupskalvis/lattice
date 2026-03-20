import { describe, expect, it } from "bun:test";
import { createDatabase } from "../../src/graph/database.ts";
import {
	deleteFileData,
	insertEdges,
	insertExternalCalls,
	insertNodes,
	insertTags,
	synthesizeEventEdges,
} from "../../src/graph/writer.ts";
import type { Edge, ExternalCall, Node, Tag } from "../../src/types/graph.ts";

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

describe("insertNodes", () => {
	it("inserts nodes into the database", () => {
		const db = createDatabase(":memory:");
		const nodes: readonly Node[] = [
			makeNode({ id: "src/test.py::foo", name: "foo" }),
			makeNode({ id: "src/test.py::bar", name: "bar", lineStart: 11, lineEnd: 20 }),
		];
		insertNodes(db, nodes);
		const count = db.query("SELECT COUNT(*) as c FROM nodes").get() as { c: number };
		expect(count.c).toBe(2);
		db.close();
	});

	it("stores metadata as JSON", () => {
		const db = createDatabase(":memory:");
		insertNodes(db, [
			makeNode({
				id: "src/routes.py::handler",
				name: "handler",
				metadata: { route: "POST /api/checkout" },
			}),
		]);
		const row = db
			.query("SELECT metadata FROM nodes WHERE id = ?")
			.get("src/routes.py::handler") as {
			metadata: string;
		};
		expect(JSON.parse(row.metadata)).toEqual({ route: "POST /api/checkout" });
		db.close();
	});
});

describe("insertEdges", () => {
	it("inserts edges into the database", () => {
		const db = createDatabase(":memory:");
		insertNodes(db, [
			makeNode({ id: "a::foo", name: "foo" }),
			makeNode({ id: "b::bar", name: "bar" }),
		]);
		const edges: readonly Edge[] = [{ sourceId: "a::foo", targetId: "b::bar", kind: "calls" }];
		insertEdges(db, edges);
		const count = db.query("SELECT COUNT(*) as c FROM edges").get() as { c: number };
		expect(count.c).toBe(1);
		db.close();
	});
});

describe("insertTags", () => {
	it("inserts tags into the database", () => {
		const db = createDatabase(":memory:");
		insertNodes(db, [makeNode({ id: "a::foo", name: "foo" })]);
		const tags: readonly Tag[] = [
			{ nodeId: "a::foo", kind: "flow", value: "checkout" },
			{ nodeId: "a::foo", kind: "boundary", value: "stripe" },
		];
		insertTags(db, tags);
		const count = db.query("SELECT COUNT(*) as c FROM tags").get() as { c: number };
		expect(count.c).toBe(2);
		db.close();
	});
});

describe("insertExternalCalls", () => {
	it("inserts external call records", () => {
		const db = createDatabase(":memory:");
		insertNodes(db, [makeNode({ id: "a::foo", name: "foo" })]);
		const calls: readonly ExternalCall[] = [
			{ nodeId: "a::foo", package: "stripe", symbol: "charges.create" },
		];
		insertExternalCalls(db, calls);
		const count = db.query("SELECT COUNT(*) as c FROM external_calls").get() as { c: number };
		expect(count.c).toBe(1);
		db.close();
	});
});

describe("deleteFileData", () => {
	it("removes all nodes, edges, tags, and external calls for a file", () => {
		const db = createDatabase(":memory:");
		insertNodes(db, [
			makeNode({ id: "a::foo", name: "foo", file: "a.py" }),
			makeNode({ id: "b::bar", name: "bar", file: "b.py" }),
		]);
		insertEdges(db, [{ sourceId: "a::foo", targetId: "b::bar", kind: "calls" }]);
		insertTags(db, [{ nodeId: "a::foo", kind: "flow", value: "checkout" }]);
		insertExternalCalls(db, [{ nodeId: "a::foo", package: "stripe", symbol: "charges.create" }]);

		deleteFileData(db, "a.py");

		const nodeCount = db.query("SELECT COUNT(*) as c FROM nodes WHERE file = 'a.py'").get() as {
			c: number;
		};
		expect(nodeCount.c).toBe(0);

		const edgeCount = db.query("SELECT COUNT(*) as c FROM edges").get() as { c: number };
		expect(edgeCount.c).toBe(0);

		const tagCount = db.query("SELECT COUNT(*) as c FROM tags").get() as { c: number };
		expect(tagCount.c).toBe(0);

		const externalCount = db.query("SELECT COUNT(*) as c FROM external_calls").get() as {
			c: number;
		};
		expect(externalCount.c).toBe(0);

		// b.py node should still exist
		const remaining = db.query("SELECT COUNT(*) as c FROM nodes").get() as { c: number };
		expect(remaining.c).toBe(1);

		db.close();
	});
});

describe("synthesizeEventEdges", () => {
	it("creates event edges from emits to handles tags", () => {
		const db = createDatabase(":memory:");
		insertNodes(db, [
			makeNode({ id: "a::emitter", name: "emitter" }),
			makeNode({ id: "b::handler", name: "handler" }),
		]);
		insertTags(db, [
			{ nodeId: "a::emitter", kind: "emits", value: "order.created" },
			{ nodeId: "b::handler", kind: "handles", value: "order.created" },
		]);

		synthesizeEventEdges(db);

		const edges = db
			.query("SELECT source_id, target_id, kind FROM edges WHERE kind = 'event'")
			.all() as { source_id: string; target_id: string; kind: string }[];
		expect(edges.length).toBe(1);
		expect(edges[0]?.source_id).toBe("a::emitter");
		expect(edges[0]?.target_id).toBe("b::handler");
		db.close();
	});

	it("replaces old event edges on re-synthesis", () => {
		const db = createDatabase(":memory:");
		insertNodes(db, [
			makeNode({ id: "a::emitter", name: "emitter" }),
			makeNode({ id: "b::handler", name: "handler" }),
		]);
		insertTags(db, [
			{ nodeId: "a::emitter", kind: "emits", value: "order.created" },
			{ nodeId: "b::handler", kind: "handles", value: "order.created" },
		]);

		synthesizeEventEdges(db);
		synthesizeEventEdges(db);

		const edges = db.query("SELECT * FROM edges WHERE kind = 'event'").all();
		expect(edges.length).toBe(1);
		db.close();
	});
});
