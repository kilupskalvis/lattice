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
	it("includes tag spec with all four tags", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("@lattice:flow");
		expect(output).toContain("@lattice:boundary");
		expect(output).toContain("@lattice:emits");
		expect(output).toContain("@lattice:handles");
	});

	it("includes few-shot examples in Python and TypeScript", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("def handle_checkout");
		expect(output).toContain("router.post");
		expect(output).toContain("@shared_task");
	});

	it("includes project summary with stats", () => {
		insertNodes(db, [
			makeNode({ id: "a::foo", name: "foo", file: "a.py" }),
			makeNode({ id: "b::bar", name: "bar", file: "b.py" }),
		]);

		const output = executePopulate(db, config);
		expect(output).toContain("2 files");
		expect(output).toContain("2 symbols");
	});

	it("shows existing tags when present", () => {
		insertNodes(db, [makeNode({ id: "src/routes.py::handler", name: "handler" })]);
		insertTags(db, [{ nodeId: "src/routes.py::handler", kind: "flow", value: "checkout" }]);

		const output = executePopulate(db, config);
		expect(output).toContain("Already Tagged");
		expect(output).toContain("@lattice:flow checkout");
	});

	it("says no tags exist when empty", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("No tags exist yet");
	});

	it("includes validation instructions", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("lattice build");
		expect(output).toContain("lattice lint");
		expect(output).toContain("lattice overview");
	});
});
