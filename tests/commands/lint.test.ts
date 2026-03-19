import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { executeLint } from "../../src/commands/lint.ts";
import { createDatabase } from "../../src/graph/database.ts";
import { insertEdges, insertNodes, insertTags } from "../../src/graph/writer.ts";
import type { LatticeConfig } from "../../src/types/config.ts";
import type { Node } from "../../src/types/graph.ts";

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

const defaultConfig: LatticeConfig = {
	languages: ["python"],
	root: ".",
	exclude: [],
	python: { sourceRoots: ["."], testPaths: ["tests"], frameworks: ["fastapi"] },
	typescript: undefined,
	lint: { strict: false, ignore: [] },
};

let db: Database;

beforeEach(() => {
	db = createDatabase(":memory:");
});

afterEach(() => {
	db.close();
});

describe("executeLint — missing tags", () => {
	it("reports missing @lattice:flow on route handler", () => {
		insertNodes(db, [
			makeNode({
				id: "src/routes.py::handler",
				name: "handler",
				metadata: { route: "POST /api/checkout" },
			}),
		]);

		const result = executeLint(db, defaultConfig);
		const flowErrors = result.issues.filter(
			(i) => i.severity === "error" && i.message.includes("flow"),
		);
		expect(flowErrors.length).toBeGreaterThan(0);
	});
});

describe("executeLint — invalid tags", () => {
	it("reports tag on a class instead of function", () => {
		insertNodes(db, [makeNode({ id: "src/svc.py::MyClass", name: "MyClass", kind: "class" })]);
		insertTags(db, [{ nodeId: "src/svc.py::MyClass", kind: "flow", value: "checkout" }]);

		const result = executeLint(db, defaultConfig);
		const invalidErrors = result.issues.filter(
			(i) => i.severity === "error" && i.message.includes("class"),
		);
		expect(invalidErrors.length).toBeGreaterThan(0);
	});
});

describe("executeLint — typos", () => {
	it("warns on flow name used only once when similar exists", () => {
		insertNodes(db, [
			makeNode({ id: "a::f1", name: "f1" }),
			makeNode({ id: "b::f2", name: "f2" }),
			makeNode({ id: "c::f3", name: "f3" }),
		]);
		insertTags(db, [
			{ nodeId: "a::f1", kind: "flow", value: "checkout" },
			{ nodeId: "b::f2", kind: "flow", value: "checkout" },
			{ nodeId: "c::f3", kind: "flow", value: "chekout" },
		]);

		const result = executeLint(db, defaultConfig);
		const typoWarnings = result.issues.filter(
			(i) => i.severity === "warning" && i.message.includes("chekout"),
		);
		expect(typoWarnings.length).toBeGreaterThan(0);
	});
});

describe("executeLint — orphaned events", () => {
	it("warns on emits with no matching handles", () => {
		insertNodes(db, [makeNode({ id: "a::emitter", name: "emitter" })]);
		insertTags(db, [{ nodeId: "a::emitter", kind: "emits", value: "order.created" }]);

		const result = executeLint(db, defaultConfig);
		const orphanWarnings = result.issues.filter(
			(i) =>
				i.severity === "warning" &&
				i.message.includes("order.created") &&
				i.message.includes("no handler"),
		);
		expect(orphanWarnings.length).toBeGreaterThan(0);
	});

	it("warns on handles with no matching emits", () => {
		insertNodes(db, [makeNode({ id: "a::handler", name: "handler" })]);
		insertTags(db, [{ nodeId: "a::handler", kind: "handles", value: "user.deleted" }]);

		const result = executeLint(db, defaultConfig);
		const orphanWarnings = result.issues.filter(
			(i) =>
				i.severity === "warning" &&
				i.message.includes("user.deleted") &&
				i.message.includes("no emitter"),
		);
		expect(orphanWarnings.length).toBeGreaterThan(0);
	});
});

describe("executeLint — stale tags", () => {
	it("warns on boundary tag when function does not call boundary package", () => {
		insertNodes(db, [makeNode({ id: "a::clean", name: "clean" })]);
		insertTags(db, [{ nodeId: "a::clean", kind: "boundary", value: "stripe" }]);
		// No edges calling stripe at all

		const result = executeLint(db, defaultConfig);
		const staleWarnings = result.issues.filter(
			(i) => i.severity === "warning" && i.message.includes("stale"),
		);
		expect(staleWarnings.length).toBeGreaterThan(0);
	});
});

describe("executeLint — clean codebase", () => {
	it("returns zero issues for properly tagged code", () => {
		insertNodes(db, [
			makeNode({ id: "a::handler", name: "handler", metadata: { route: "POST /api" } }),
			makeNode({ id: "b::charge", name: "charge" }),
		]);
		insertTags(db, [
			{ nodeId: "a::handler", kind: "flow", value: "checkout" },
			{ nodeId: "b::charge", kind: "boundary", value: "stripe" },
		]);
		insertEdges(db, [
			{
				sourceId: "b::charge",
				targetId: "stripe.charges.create",
				kind: "calls",
				certainty: "uncertain",
			},
		]);

		const result = executeLint(db, defaultConfig);
		const errors = result.issues.filter((i) => i.severity === "error");
		expect(errors.length).toBe(0);
	});
});

describe("executeLint — coverage", () => {
	it("reports coverage stats", () => {
		insertNodes(db, [
			makeNode({ id: "a::h1", name: "h1", metadata: { route: "POST /a" } }),
			makeNode({ id: "b::h2", name: "h2", metadata: { route: "GET /b" } }),
		]);
		insertTags(db, [{ nodeId: "a::h1", kind: "flow", value: "a" }]);

		const result = executeLint(db, defaultConfig);
		expect(result.coverage.tagged).toBe(1);
		expect(result.coverage.total).toBe(2);
	});
});
