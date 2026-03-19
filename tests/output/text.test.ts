import { describe, expect, it } from "bun:test";
import type { BoundaryEntry, EventConnection, FlowEntry } from "../../src/graph/queries.ts";
import {
	formatBoundaries,
	formatCallers,
	formatContext,
	formatEvents,
	formatFlowTree,
	formatImpact,
	formatOverview,
} from "../../src/output/text.ts";
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

describe("formatOverview", () => {
	it("formats flows, boundaries, and events", () => {
		const flows: FlowEntry[] = [
			{
				value: "checkout",
				node: makeNode({
					id: "src/routes.py::handle_checkout",
					name: "handle_checkout",
					file: "src/routes.py",
					lineStart: 12,
					metadata: { route: "POST /api/checkout" },
				}),
			},
		];
		const boundaries: BoundaryEntry[] = [
			{ value: "stripe", node: makeNode({ id: "src/pay.py::charge", name: "charge" }) },
		];
		const events: EventConnection[] = [
			{
				eventName: "order.created",
				emitterName: "emit_created",
				emitterFile: "src/services.py",
				handlerName: "send_email",
				handlerFile: "src/workers.py",
			},
		];

		const output = formatOverview(flows, boundaries, events);
		expect(output).toContain("Flows:");
		expect(output).toContain("checkout");
		expect(output).toContain("POST /api/checkout");
		expect(output).toContain("Boundaries:");
		expect(output).toContain("stripe");
		expect(output).toContain("Events:");
		expect(output).toContain("order.created");
	});
});

describe("formatFlowTree", () => {
	it("formats a call tree with boundary and event markers", () => {
		type TreeNode = {
			node: Node;
			boundary: string | undefined;
			emits: string | undefined;
			children: TreeNode[];
		};

		const tree: TreeNode = {
			node: makeNode({ id: "r::handler", name: "handler", file: "src/routes.py", lineStart: 12 }),
			boundary: undefined,
			emits: undefined,
			children: [
				{
					node: makeNode({
						id: "s::create",
						name: "create_order",
						file: "src/svc.py",
						lineStart: 20,
					}),
					boundary: undefined,
					emits: undefined,
					children: [
						{
							node: makeNode({
								id: "g::charge",
								name: "charge",
								file: "src/pay.py",
								lineStart: 23,
							}),
							boundary: "stripe",
							emits: undefined,
							children: [],
						},
					],
				},
			],
		};

		const output = formatFlowTree(tree);
		expect(output).toContain("handler");
		expect(output).toContain("create_order");
		expect(output).toContain("[stripe]");
		expect(output).toContain("charge");
	});
});

describe("formatContext", () => {
	it("formats a symbol's neighborhood", () => {
		const output = formatContext({
			node: makeNode({
				id: "src/pay.py::charge",
				name: "charge",
				file: "src/pay.py",
				lineStart: 23,
				lineEnd: 48,
				signature: "charge(amount: Decimal, token: str) -> PaymentResult",
			}),
			flows: ["checkout", "subscription"],
			callers: [
				makeNode({
					id: "src/svc.py::create_order",
					name: "create_order",
					file: "src/svc.py",
					lineStart: 20,
				}),
			],
			callees: [
				makeNode({
					id: "src/pay.py::build_payload",
					name: "build_payload",
					file: "src/pay.py",
					lineStart: 56,
				}),
			],
			boundary: "stripe",
		});

		expect(output).toContain("charge");
		expect(output).toContain("src/pay.py:23");
		expect(output).toContain("charge(amount: Decimal, token: str) -> PaymentResult");
		expect(output).toContain("checkout, subscription");
		expect(output).toContain("create_order");
		expect(output).toContain("build_payload");
		expect(output).toContain("stripe");
	});
});

describe("formatImpact", () => {
	it("formats impact analysis", () => {
		const output = formatImpact({
			directCallers: [
				makeNode({
					id: "src/svc.py::create_order",
					name: "create_order",
					file: "src/svc.py",
					lineStart: 20,
				}),
			],
			transitiveCallers: [
				makeNode({
					id: "src/routes.py::handler",
					name: "handler",
					file: "src/routes.py",
					lineStart: 12,
				}),
			],
			affectedFlows: ["checkout"],
			affectedTests: [
				makeNode({
					id: "tests/test.py::test_charge",
					name: "test_charge",
					file: "tests/test.py",
					lineStart: 1,
					isTest: true,
				}),
			],
		});

		expect(output).toContain("Direct callers:");
		expect(output).toContain("create_order");
		expect(output).toContain("Transitive callers:");
		expect(output).toContain("handler");
		expect(output).toContain("Affected flows:");
		expect(output).toContain("checkout");
		expect(output).toContain("Tests:");
		expect(output).toContain("test_charge");
	});
});

describe("formatCallers", () => {
	it("formats a list of callers", () => {
		const output = formatCallers([
			makeNode({
				id: "src/svc.py::create_order",
				name: "create_order",
				file: "src/svc.py",
				lineStart: 20,
			}),
		]);
		expect(output).toContain("← create_order");
		expect(output).toContain("src/svc.py:20");
	});
});

describe("formatBoundaries", () => {
	it("formats boundaries grouped by system", () => {
		const entries: BoundaryEntry[] = [
			{
				value: "stripe",
				node: makeNode({ id: "a::charge", name: "charge", file: "src/pay.py", lineStart: 23 }),
			},
			{
				value: "postgres",
				node: makeNode({ id: "b::save", name: "save", file: "src/db.py", lineStart: 34 }),
			},
			{
				value: "postgres",
				node: makeNode({ id: "c::query", name: "query", file: "src/db.py", lineStart: 12 }),
			},
		];
		const output = formatBoundaries(entries);
		expect(output).toContain("stripe");
		expect(output).toContain("postgres");
		expect(output).toContain("charge");
		expect(output).toContain("save");
	});
});

describe("formatEvents", () => {
	it("formats event connections", () => {
		const events: EventConnection[] = [
			{
				eventName: "order.created",
				emitterName: "emit_created",
				emitterFile: "src/svc.py",
				handlerName: "send_email",
				handlerFile: "src/workers.py",
			},
		];
		const output = formatEvents(events);
		expect(output).toContain("order.created");
		expect(output).toContain("emit_created");
		expect(output).toContain("send_email");
	});
});
