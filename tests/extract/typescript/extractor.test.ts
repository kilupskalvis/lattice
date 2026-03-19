import { beforeAll, describe, expect, it } from "bun:test";
import type { Extractor } from "../../../src/extract/extractor.ts";
import { initTreeSitter } from "../../../src/extract/parser.ts";
import { createTypeScriptExtractor } from "../../../src/extract/typescript/extractor.ts";

let extractor: Extractor;

beforeAll(async () => {
	await initTreeSitter();
	extractor = await createTypeScriptExtractor();
});

describe("TypeScriptExtractor", () => {
	it("has correct language and extensions", () => {
		expect(extractor.language).toBe("typescript");
		expect(extractor.fileExtensions).toContain(".ts");
		expect(extractor.fileExtensions).toContain(".tsx");
	});

	it("extracts nodes and tags from a tagged file", async () => {
		const source = `import Stripe from "stripe";

// @lattice:boundary stripe
export async function charge(amount: number): Promise<Result> {
  const payload = buildPayload(amount);
  return stripe.charges.create(payload);
}

function buildPayload(amount: number): Stripe.ChargeCreateParams {
  return { amount, currency: "usd" };
}
`;
		const result = await extractor.extract("src/gateways/payment.ts", source);

		expect(result.nodes.length).toBe(2);
		const chargeNode = result.nodes.find((n) => n.name === "charge");
		expect(chargeNode).toBeDefined();

		expect(result.tags.length).toBe(1);
		expect(result.tags[0]?.kind).toBe("boundary");
		expect(result.tags[0]?.value).toBe("stripe");
		expect(result.tags[0]?.nodeId).toBe("src/gateways/payment.ts::charge");

		// Should have call edges
		const chargeEdges = result.edges.filter(
			(e) => e.sourceId === "src/gateways/payment.ts::charge",
		);
		expect(chargeEdges.length).toBeGreaterThan(0);
	});

	it("extracts flow tags", async () => {
		const source = `// @lattice:flow checkout
export async function handleCheckout(req: Request): Promise<Response> {
  return new Response("ok");
}
`;
		const result = await extractor.extract("src/routes/checkout.ts", source);
		const flowTag = result.tags.find((t) => t.kind === "flow");
		expect(flowTag).toBeDefined();
		expect(flowTag?.value).toBe("checkout");
	});

	it("returns empty for empty file", async () => {
		const result = await extractor.extract("empty.ts", "");
		expect(result.nodes.length).toBe(0);
	});
});
