import { describe, expect, test } from "bun:test";
import { scanTags } from "../../src/extract/tag-scanner.ts";
import type { Node } from "../../src/types/graph.ts";

function makeNode(overrides: Partial<Node> & { id: string; name: string }): Node {
	return {
		kind: "function",
		file: "a.ts",
		lineStart: 1,
		lineEnd: 10,
		language: "typescript",
		signature: undefined,
		isTest: false,
		metadata: undefined,
		...overrides,
	};
}

describe("scanTags", () => {
	test("finds tags and associates with nearest symbol below", () => {
		const source = `// @lattice:flow checkout
function handleCheckout() {}

// @lattice:boundary stripe
function charge() {}`;

		const nodes: Node[] = [
			makeNode({ id: "a.ts::handleCheckout", name: "handleCheckout", lineStart: 2, lineEnd: 2 }),
			makeNode({ id: "a.ts::charge", name: "charge", lineStart: 5, lineEnd: 5 }),
		];

		const result = scanTags(source, nodes);
		expect(result.tags).toHaveLength(2);
		expect(result.tags[0]).toEqual({
			nodeId: "a.ts::handleCheckout",
			kind: "flow",
			value: "checkout",
		});
		expect(result.tags[1]).toEqual({
			nodeId: "a.ts::charge",
			kind: "boundary",
			value: "stripe",
		});
		expect(result.errors).toHaveLength(0);
	});

	test("handles Python comment style", () => {
		const source = `# @lattice:flow checkout
def handle_checkout():
    pass`;

		const nodes: Node[] = [
			makeNode({
				id: "a.py::handle_checkout",
				name: "handle_checkout",
				file: "a.py",
				lineStart: 2,
				lineEnd: 3,
				language: "python",
			}),
		];

		const result = scanTags(source, nodes);
		expect(result.tags).toHaveLength(1);
		expect(result.tags[0]).toEqual({
			nodeId: "a.py::handle_checkout",
			kind: "flow",
			value: "checkout",
		});
	});

	test("handles multiple values on one tag", () => {
		const source = `// @lattice:flow checkout, payment
function handler() {}`;

		const nodes: Node[] = [
			makeNode({ id: "a.ts::handler", name: "handler", lineStart: 2, lineEnd: 2 }),
		];

		const result = scanTags(source, nodes);
		expect(result.tags).toHaveLength(2);
		expect(result.tags[0]?.value).toBe("checkout");
		expect(result.tags[1]?.value).toBe("payment");
	});

	test("reports error for unknown tag kind", () => {
		const source = `// @lattice:unknown value
function foo() {}`;

		const nodes: Node[] = [makeNode({ id: "a.ts::foo", name: "foo", lineStart: 2, lineEnd: 2 })];

		const result = scanTags(source, nodes);
		expect(result.tags).toHaveLength(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("unknown tag kind");
	});

	test("reports error for invalid tag name", () => {
		const source = `// @lattice:flow Invalid Name
function foo() {}`;

		const nodes: Node[] = [makeNode({ id: "a.ts::foo", name: "foo", lineStart: 2, lineEnd: 2 })];

		const result = scanTags(source, nodes);
		expect(result.tags).toHaveLength(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("invalid tag name");
	});

	test("skips tags with no symbol below", () => {
		const source = `// @lattice:flow orphan
// just a comment`;
		const result = scanTags(source, []);
		expect(result.tags).toHaveLength(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("no function below it");
	});

	test("skips type and variable nodes for association", () => {
		const source = `// @lattice:flow checkout
type MyType = string;
function handler() {}`;

		const nodes: Node[] = [
			makeNode({ id: "a.ts::MyType", name: "MyType", kind: "type", lineStart: 2, lineEnd: 2 }),
			makeNode({ id: "a.ts::handler", name: "handler", lineStart: 3, lineEnd: 3 }),
		];

		const result = scanTags(source, nodes);
		expect(result.tags).toHaveLength(1);
		expect(result.tags[0]?.nodeId).toBe("a.ts::handler");
	});
});
