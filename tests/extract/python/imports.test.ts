import { beforeAll, describe, expect, it } from "bun:test";
import {
	createParser,
	initTreeSitter,
	type TreeSitterParser,
} from "../../../src/extract/parser.ts";
import { extractPythonImports } from "../../../src/extract/python/imports.ts";

let parser: TreeSitterParser;

beforeAll(async () => {
	await initTreeSitter();
	parser = await createParser("python");
});

describe("extractPythonImports", () => {
	it("extracts 'import os'", () => {
		const source = "import os";
		const tree = parser.parse(source);
		const imports = extractPythonImports(tree, "test.py");
		expect(imports.length).toBe(1);
		expect(imports[0]?.module).toBe("os");
		expect(imports[0]?.names).toEqual([]);
		expect(imports[0]?.isRelative).toBe(false);
	});

	it("extracts 'from os.path import join'", () => {
		const source = "from os.path import join";
		const tree = parser.parse(source);
		const imports = extractPythonImports(tree, "test.py");
		expect(imports.length).toBe(1);
		expect(imports[0]?.module).toBe("os.path");
		expect(imports[0]?.names).toEqual(["join"]);
	});

	it("extracts 'from os.path import join, exists'", () => {
		const source = "from os.path import join, exists";
		const tree = parser.parse(source);
		const imports = extractPythonImports(tree, "test.py");
		expect(imports[0]?.names).toEqual(["join", "exists"]);
	});

	it("extracts relative import 'from .sibling import foo'", () => {
		const source = "from .sibling import foo";
		const tree = parser.parse(source);
		const imports = extractPythonImports(tree, "test.py");
		expect(imports.length).toBe(1);
		expect(imports[0]?.module).toBe(".sibling");
		expect(imports[0]?.names).toEqual(["foo"]);
		expect(imports[0]?.isRelative).toBe(true);
	});

	it("extracts absolute import 'from src.services.order import create_order'", () => {
		const source = "from src.services.order import create_order";
		const tree = parser.parse(source);
		const imports = extractPythonImports(tree, "test.py");
		expect(imports[0]?.module).toBe("src.services.order");
		expect(imports[0]?.names).toEqual(["create_order"]);
		expect(imports[0]?.isRelative).toBe(false);
	});

	it("extracts multiple import statements", () => {
		const source = "import os\nimport sys\nfrom pathlib import Path";
		const tree = parser.parse(source);
		const imports = extractPythonImports(tree, "test.py");
		expect(imports.length).toBe(3);
	});

	it("returns empty for file with no imports", () => {
		const source = "def foo():\n    pass";
		const tree = parser.parse(source);
		const imports = extractPythonImports(tree, "test.py");
		expect(imports.length).toBe(0);
	});

	it("returns empty for empty file", () => {
		const tree = parser.parse("");
		const imports = extractPythonImports(tree, "test.py");
		expect(imports.length).toBe(0);
	});

	it("handles aliased imports", () => {
		const source = "from collections import OrderedDict as OD";
		const tree = parser.parse(source);
		const imports = extractPythonImports(tree, "test.py");
		expect(imports[0]?.names).toEqual(["OrderedDict"]);
		expect(imports[0]?.aliases?.get("OrderedDict")).toBe("OD");
	});

	it("handles 'import x as y'", () => {
		const source = "import numpy as np";
		const tree = parser.parse(source);
		const imports = extractPythonImports(tree, "test.py");
		expect(imports[0]?.module).toBe("numpy");
		expect(imports[0]?.aliases?.get("numpy")).toBe("np");
	});
});
