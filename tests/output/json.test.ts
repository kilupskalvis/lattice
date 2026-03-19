import { describe, expect, it } from "bun:test";
import type { BoundaryEntry, EventConnection, FlowEntry } from "../../src/graph/queries.ts";
import { formatContextJson, formatOverviewJson } from "../../src/output/json.ts";
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

describe("formatOverviewJson", () => {
	it("produces valid JSON with flows, boundaries, events", () => {
		const flows: FlowEntry[] = [
			{
				value: "checkout",
				node: makeNode({
					id: "src/routes.py::handler",
					name: "handler",
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
				emitterFile: "src/svc.py",
				handlerName: "send_email",
				handlerFile: "src/workers.py",
			},
		];

		const output = formatOverviewJson(flows, boundaries, events);
		const parsed = JSON.parse(output);
		expect(parsed.flows.length).toBe(1);
		expect(parsed.flows[0].name).toBe("checkout");
		expect(parsed.boundaries.length).toBe(1);
		expect(parsed.events.length).toBe(1);
	});
});

describe("formatContextJson", () => {
	it("produces valid JSON with node details", () => {
		const output = formatContextJson({
			node: makeNode({
				id: "src/pay.py::charge",
				name: "charge",
				signature: "charge(amount, token)",
			}),
			flows: ["checkout"],
			callers: [makeNode({ id: "src/svc.py::create", name: "create" })],
			callees: [],
			boundary: "stripe",
		});

		const parsed = JSON.parse(output);
		expect(parsed.name).toBe("charge");
		expect(parsed.flows).toEqual(["checkout"]);
		expect(parsed.callers.length).toBe(1);
		expect(parsed.boundary).toBe("stripe");
	});
});
