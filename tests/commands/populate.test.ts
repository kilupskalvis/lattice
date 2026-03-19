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
	python: { sourceRoots: ["."], testPaths: ["tests"] },
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

	it("includes the complete workflow with all steps", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("Step 1: Tag entry points");
		expect(output).toContain("Step 2: Tag boundaries");
		expect(output).toContain("Step 3: Tag events");
		expect(output).toContain("Step 4: Rebuild and lint");
		expect(output).toContain("Step 5: Verify flows");
		expect(output).toContain("Step 6: Verify call trees");
		expect(output).toContain("Step 7: Verify impact");
	});

	it("includes validation commands in the workflow", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("lattice build && lattice lint");
		expect(output).toContain("lattice overview");
		expect(output).toContain("lattice flow <name>");
		expect(output).toContain("lattice impact <symbol>");
	});

	it("includes done criteria", () => {
		const output = executePopulate(db, config);
		expect(output).toContain("lint reports zero errors");
		expect(output).toContain("complete, sensible call tree");
	});
});
