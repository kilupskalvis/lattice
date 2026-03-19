import { beforeAll, describe, expect, it } from "bun:test";
import {
	createParser,
	initTreeSitter,
	type TreeSitterParser,
} from "../../../src/extract/parser.ts";
import { extractPythonCalls } from "../../../src/extract/python/calls.ts";

let parser: TreeSitterParser;

beforeAll(async () => {
	await initTreeSitter();
	parser = await createParser("python");
});

describe("extractPythonCalls", () => {
	it("detects a simple function call", () => {
		const source = "def foo():\n    bar()";
		const tree = parser.parse(source);
		const calls = extractPythonCalls(tree, "test.py");
		expect(calls.length).toBe(1);
		expect(calls[0]?.sourceId).toBe("test.py::foo");
		expect(calls[0]?.callee).toBe("bar");
	});

	it("detects an attribute call like module.func()", () => {
		const source = "def foo():\n    os.path.join('a', 'b')";
		const tree = parser.parse(source);
		const calls = extractPythonCalls(tree, "test.py");
		expect(calls.length).toBe(1);
		expect(calls[0]?.callee).toBe("os.path.join");
	});

	it("detects self.method() calls", () => {
		const source = "class Svc:\n    def run(self):\n        self.process()";
		const tree = parser.parse(source);
		const calls = extractPythonCalls(tree, "test.py");
		expect(calls.length).toBe(1);
		expect(calls[0]?.sourceId).toBe("test.py::Svc.run");
		expect(calls[0]?.callee).toBe("self.process");
	});

	it("detects multiple calls in one function", () => {
		const source = "def foo():\n    bar()\n    baz()";
		const tree = parser.parse(source);
		const calls = extractPythonCalls(tree, "test.py");
		expect(calls.length).toBe(2);
	});

	it("scopes calls to the enclosing function", () => {
		const source = "def foo():\n    bar()\n\ndef baz():\n    qux()";
		const tree = parser.parse(source);
		const calls = extractPythonCalls(tree, "test.py");
		const fooCalls = calls.filter((c) => c.sourceId === "test.py::foo");
		const bazCalls = calls.filter((c) => c.sourceId === "test.py::baz");
		expect(fooCalls.length).toBe(1);
		expect(fooCalls[0]?.callee).toBe("bar");
		expect(bazCalls.length).toBe(1);
		expect(bazCalls[0]?.callee).toBe("qux");
	});

	it("detects calls inside class methods", () => {
		const source = "class Svc:\n    def run(self):\n        helper()";
		const tree = parser.parse(source);
		const calls = extractPythonCalls(tree, "test.py");
		expect(calls[0]?.sourceId).toBe("test.py::Svc.run");
		expect(calls[0]?.callee).toBe("helper");
	});

	it("returns empty for function with no calls", () => {
		const source = "def foo():\n    x = 1 + 2";
		const tree = parser.parse(source);
		const calls = extractPythonCalls(tree, "test.py");
		expect(calls.length).toBe(0);
	});

	it("returns empty for empty file", () => {
		const tree = parser.parse("");
		const calls = extractPythonCalls(tree, "test.py");
		expect(calls.length).toBe(0);
	});

	it("handles chained attribute calls", () => {
		const source = "def foo():\n    stripe.charges.create(amount=100)";
		const tree = parser.parse(source);
		const calls = extractPythonCalls(tree, "test.py");
		expect(calls.length).toBe(1);
		expect(calls[0]?.callee).toBe("stripe.charges.create");
	});
});
