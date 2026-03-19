import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { executePopulate } from "../../src/commands/populate.ts";
import { createDatabase } from "../../src/graph/database.ts";
import { insertNodes, insertTags } from "../../src/graph/writer.ts";
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
	it("includes the full tag specification", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("@lattice:flow");
		expect(output).toContain("@lattice:boundary");
		expect(output).toContain("@lattice:emits");
		expect(output).toContain("@lattice:handles");
		expect(output).toContain("kebab-case");
	});

	it("includes project structure with files and key functions", () => {
		insertNodes(db, [
			makeNode({
				id: "src/routes.py::handler",
				name: "handler",
				file: "src/routes.py",
				lineStart: 12,
			}),
			makeNode({ id: "src/pay.py::charge", name: "charge", file: "src/pay.py" }),
		]);

		const output = executePopulate(db, config);
		expect(output).toContain("Project Structure");
		expect(output).toContain("src/routes.py");
		expect(output).toContain("src/pay.py");
		expect(output).toContain("handler");
		expect(output).toContain("charge");
	});

	it("shows existing tags when present", () => {
		insertNodes(db, [
			makeNode({ id: "src/routes.py::handler", name: "handler", file: "src/routes.py" }),
		]);
		insertTags(db, [{ nodeId: "src/routes.py::handler", kind: "flow", value: "checkout" }]);

		const output = executePopulate(db, config);
		expect(output).toContain("Existing Tags");
		expect(output).toContain("@lattice:flow checkout");
	});

	it("includes guidelines for tagging approach", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("Guidelines");
		expect(output).toContain("entry points");
		expect(output).toContain("external boundaries");
	});

	it("includes validation instructions", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("lattice build");
		expect(output).toContain("lattice lint");
		expect(output).toContain("lattice overview");
	});

	it("works on empty database", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("@lattice:flow");
		expect(output).toContain("Files (0)");
	});
});
