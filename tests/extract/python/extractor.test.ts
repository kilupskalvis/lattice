import { beforeAll, describe, expect, it } from "bun:test";
import type { Extractor } from "../../../src/extract/extractor.ts";
import { initTreeSitter } from "../../../src/extract/parser.ts";
import { createPythonExtractor } from "../../../src/extract/python/extractor.ts";

let extractor: Extractor;

beforeAll(async () => {
	await initTreeSitter();
	extractor = await createPythonExtractor();
});

describe("PythonExtractor", () => {
	it("has correct language and extensions", () => {
		expect(extractor.language).toBe("python");
		expect(extractor.fileExtensions).toContain(".py");
	});

	it("extracts nodes, edges, and tags from a tagged file", async () => {
		const source = `import stripe

# @lattice:boundary stripe
def charge(amount: float, token: str) -> dict:
    payload = build_stripe_payload(amount, token)
    return stripe.charges.create(**payload)

def build_stripe_payload(amount, token):
    return {"amount": int(amount * 100), "source": token}
`;
		const result = await extractor.extract("src/gateways/payment.py", source);

		// Should find 2 functions
		expect(result.nodes.length).toBe(2);
		const chargeNode = result.nodes.find((n) => n.name === "charge");
		expect(chargeNode).toBeDefined();
		expect(chargeNode?.signature).toBe("charge(amount: float, token: str) -> dict");

		const buildNode = result.nodes.find((n) => n.name === "build_stripe_payload");
		expect(buildNode).toBeDefined();

		// Should find the boundary tag on charge
		expect(result.tags.length).toBe(1);
		expect(result.tags[0]?.kind).toBe("boundary");
		expect(result.tags[0]?.value).toBe("stripe");
		expect(result.tags[0]?.nodeId).toBe("src/gateways/payment.py::charge");

		// Should find call edges from charge to build_stripe_payload and stripe.charges.create
		const chargeEdges = result.edges.filter(
			(e) => e.sourceId === "src/gateways/payment.py::charge",
		);
		expect(chargeEdges.length).toBeGreaterThan(0);
	});

	it("extracts emits and handles tags", async () => {
		const source = `# @lattice:emits order.created
def emit_order(order_id):
    queue.publish("order.created", {"order_id": order_id})
`;
		const result = await extractor.extract("src/events.py", source);
		expect(result.tags.length).toBe(1);
		expect(result.tags[0]?.kind).toBe("emits");
		expect(result.tags[0]?.value).toBe("order.created");
	});

	it("extracts flow tags with route metadata", async () => {
		const source = `# @lattice:flow checkout
@app.post("/api/checkout")
def handle_checkout(req):
    create_order(req)
`;
		const result = await extractor.extract("src/routes.py", source);

		const flowTag = result.tags.find((t) => t.kind === "flow");
		expect(flowTag).toBeDefined();
		expect(flowTag?.value).toBe("checkout");

		const node = result.nodes.find((n) => n.name === "handle_checkout");
		expect(node?.metadata?.route).toBe("POST /api/checkout");
	});

	it("returns empty result for empty file", async () => {
		const result = await extractor.extract("empty.py", "");
		expect(result.nodes.length).toBe(0);
		expect(result.edges.length).toBe(0);
		expect(result.tags.length).toBe(0);
	});

	it("handles file with no tags", async () => {
		const source = "def helper(x):\n    return x + 1";
		const result = await extractor.extract("src/util.py", source);
		expect(result.nodes.length).toBe(1);
		expect(result.tags.length).toBe(0);
	});
});
