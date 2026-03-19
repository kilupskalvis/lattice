import { beforeAll, describe, expect, it } from "bun:test";
import {
	createParser,
	initTreeSitter,
	type TreeSitterParser,
} from "../../../src/extract/parser.ts";
import { extractPythonSymbols } from "../../../src/extract/python/symbols.ts";

let parser: TreeSitterParser;

beforeAll(async () => {
	await initTreeSitter();
	parser = await createParser("python");
});

describe("extractPythonSymbols", () => {
	it("extracts a top-level function", () => {
		const source = "def foo(x: int) -> str:\n    return str(x)";
		const tree = parser.parse(source);
		const nodes = extractPythonSymbols(tree, "src/test.py", source);
		expect(nodes.length).toBe(1);
		expect(nodes[0]?.name).toBe("foo");
		expect(nodes[0]?.id).toBe("src/test.py::foo");
		expect(nodes[0]?.kind).toBe("function");
		expect(nodes[0]?.lineStart).toBe(1);
		expect(nodes[0]?.lineEnd).toBe(2);
		expect(nodes[0]?.language).toBe("python");
	});

	it("extracts function signature with type hints", () => {
		const source = "def charge(amount: float, token: str) -> dict:\n    pass";
		const tree = parser.parse(source);
		const nodes = extractPythonSymbols(tree, "src/pay.py", source);
		expect(nodes[0]?.signature).toBe("charge(amount: float, token: str) -> dict");
	});

	it("extracts a class and its methods", () => {
		const source =
			"class UserService:\n    def get_user(self, id: int) -> User:\n        pass\n    def create_user(self, data: dict) -> User:\n        pass";
		const tree = parser.parse(source);
		const nodes = extractPythonSymbols(tree, "src/svc.py", source);

		const classNode = nodes.find((n) => n.name === "UserService");
		expect(classNode).toBeDefined();
		expect(classNode?.kind).toBe("class");

		const getUser = nodes.find((n) => n.name === "get_user");
		expect(getUser).toBeDefined();
		expect(getUser?.kind).toBe("method");
		expect(getUser?.id).toBe("src/svc.py::UserService.get_user");

		const createUser = nodes.find((n) => n.name === "create_user");
		expect(createUser).toBeDefined();
		expect(createUser?.id).toBe("src/svc.py::UserService.create_user");
	});

	it("extracts nested functions with parent-scoped IDs", () => {
		const source = "def outer():\n    def inner():\n        pass\n    inner()";
		const tree = parser.parse(source);
		const nodes = extractPythonSymbols(tree, "src/nest.py", source);

		const outer = nodes.find((n) => n.name === "outer");
		expect(outer).toBeDefined();
		expect(outer?.id).toBe("src/nest.py::outer");

		const inner = nodes.find((n) => n.name === "inner");
		expect(inner).toBeDefined();
		expect(inner?.id).toBe("src/nest.py::outer.inner");
	});

	it("extracts multiple top-level functions", () => {
		const source = "def foo():\n    pass\n\ndef bar():\n    pass";
		const tree = parser.parse(source);
		const nodes = extractPythonSymbols(tree, "src/multi.py", source);
		const funcNodes = nodes.filter((n) => n.kind === "function");
		expect(funcNodes.length).toBe(2);
	});

	it("includes decorated functions with correct line range", () => {
		const source = '@app.post("/api/checkout")\ndef handle_checkout(req):\n    pass';
		const tree = parser.parse(source);
		const nodes = extractPythonSymbols(tree, "src/routes.py", source);
		expect(nodes.length).toBe(1);
		expect(nodes[0]?.name).toBe("handle_checkout");
		// Decorated function starts at the decorator line
		expect(nodes[0]?.lineStart).toBe(1);
		expect(nodes[0]?.lineEnd).toBe(3);
	});

	it("extracts function without type hints", () => {
		const source = "def simple(a, b):\n    return a + b";
		const tree = parser.parse(source);
		const nodes = extractPythonSymbols(tree, "src/s.py", source);
		expect(nodes[0]?.signature).toBe("simple(a, b)");
	});

	it("handles async functions", () => {
		const source = "async def fetch_data(url: str) -> dict:\n    pass";
		const tree = parser.parse(source);
		const nodes = extractPythonSymbols(tree, "src/async.py", source);
		expect(nodes.length).toBe(1);
		expect(nodes[0]?.name).toBe("fetch_data");
		expect(nodes[0]?.signature).toContain("fetch_data");
	});

	it("handles empty file", () => {
		const tree = parser.parse("");
		const nodes = extractPythonSymbols(tree, "src/empty.py", "");
		expect(nodes.length).toBe(0);
	});
});
