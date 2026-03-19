import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { executePopulate } from "../../src/commands/populate.ts";
import { createDatabase } from "../../src/graph/database.ts";
import { insertEdges, insertNodes } from "../../src/graph/writer.ts";
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

const config: LatticeConfig = {
	languages: ["python"],
	root: ".",
	exclude: [],
	python: { sourceRoots: ["."], testPaths: ["tests"], frameworks: ["fastapi"] },
	typescript: undefined,
	lint: { strict: false, ignore: [], boundaryPackages: ["stripe"] },
};

let db: Database;

beforeEach(() => {
	db = createDatabase(":memory:");
});

afterEach(() => {
	db.close();
});

describe("executePopulate", () => {
	it("includes the tag specification", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("@lattice:flow");
		expect(output).toContain("@lattice:boundary");
		expect(output).toContain("@lattice:emits");
		expect(output).toContain("@lattice:handles");
	});

	it("lists untagged route handlers needing @lattice:flow", () => {
		insertNodes(db, [
			makeNode({
				id: "src/routes.py::handler",
				name: "handler",
				file: "src/routes.py",
				lineStart: 12,
				metadata: { route: "POST /api/checkout" },
			}),
		]);

		const output = executePopulate(db, config);
		expect(output).toContain("handler");
		expect(output).toContain("src/routes.py:12");
		expect(output).toContain("@lattice:flow");
	});

	it("lists untagged functions calling boundary packages needing @lattice:boundary", () => {
		insertNodes(db, [makeNode({ id: "src/pay.py::charge", name: "charge", file: "src/pay.py" })]);
		insertEdges(db, [
			{
				sourceId: "src/pay.py::charge",
				targetId: "stripe.charges.create",
				kind: "calls",
				certainty: "uncertain",
			},
		]);

		const output = executePopulate(db, config);
		expect(output).toContain("charge");
		expect(output).toContain("@lattice:boundary");
	});

	it("includes post-populate instructions", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("lattice build");
		expect(output).toContain("lattice lint");
	});

	it("returns minimal output when no candidates found", () => {
		const output = executePopulate(db, config);
		// Should still have the tag spec and instructions
		expect(output).toContain("@lattice:flow");
		expect(output).toContain("lattice build");
	});
});
