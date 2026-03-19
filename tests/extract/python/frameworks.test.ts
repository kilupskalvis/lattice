import { beforeAll, describe, expect, it } from "bun:test";
import {
	createParser,
	initTreeSitter,
	type TreeSitterParser,
} from "../../../src/extract/parser.ts";
import { detectPythonFrameworks } from "../../../src/extract/python/frameworks.ts";

let parser: TreeSitterParser;

beforeAll(async () => {
	await initTreeSitter();
	parser = await createParser("python");
});

describe("detectPythonFrameworks — FastAPI", () => {
	it("detects @app.post decorator with route", () => {
		const source = '@app.post("/api/checkout")\ndef handle_checkout(req):\n    pass';
		const tree = parser.parse(source);
		const results = detectPythonFrameworks(tree, "src/routes.py");
		expect(results.length).toBe(1);
		expect(results[0]?.functionName).toBe("handle_checkout");
		expect(results[0]?.route).toBe("POST /api/checkout");
	});

	it("detects @app.get decorator", () => {
		const source = '@app.get("/api/users")\ndef list_users():\n    pass';
		const tree = parser.parse(source);
		const results = detectPythonFrameworks(tree, "src/routes.py");
		expect(results[0]?.route).toBe("GET /api/users");
	});

	it("detects @router.delete decorator", () => {
		const source = '@router.delete("/api/items/{id}")\ndef delete_item(id):\n    pass';
		const tree = parser.parse(source);
		const results = detectPythonFrameworks(tree, "src/routes.py");
		expect(results[0]?.route).toBe("DELETE /api/items/{id}");
	});

	it("does not flag non-route decorators", () => {
		const source = "@dataclass\nclass Config:\n    pass";
		const tree = parser.parse(source);
		const results = detectPythonFrameworks(tree, "src/models.py");
		expect(results.length).toBe(0);
	});
});

describe("detectPythonFrameworks — Flask", () => {
	it("detects @app.route with methods", () => {
		const source = '@app.route("/checkout", methods=["POST"])\ndef checkout():\n    pass';
		const tree = parser.parse(source);
		const results = detectPythonFrameworks(tree, "src/views.py");
		expect(results.length).toBe(1);
		expect(results[0]?.functionName).toBe("checkout");
		expect(results[0]?.route).toContain("/checkout");
	});

	it("detects @blueprint.route", () => {
		const source = '@bp.route("/users")\ndef users():\n    pass';
		const tree = parser.parse(source);
		const results = detectPythonFrameworks(tree, "src/views.py");
		expect(results.length).toBe(1);
		expect(results[0]?.route).toContain("/users");
	});
});

describe("detectPythonFrameworks — Celery", () => {
	it("detects @app.task decorator", () => {
		const source = "@app.task\ndef process_order(order_id):\n    pass";
		const tree = parser.parse(source);
		const results = detectPythonFrameworks(tree, "src/tasks.py");
		expect(results.length).toBe(1);
		expect(results[0]?.functionName).toBe("process_order");
		expect(results[0]?.isEntryPoint).toBe(true);
	});

	it("detects @shared_task decorator", () => {
		const source = "@shared_task\ndef send_email(to):\n    pass";
		const tree = parser.parse(source);
		const results = detectPythonFrameworks(tree, "src/tasks.py");
		expect(results.length).toBe(1);
		expect(results[0]?.isEntryPoint).toBe(true);
	});
});

describe("detectPythonFrameworks — general", () => {
	it("returns empty for file with no frameworks", () => {
		const source = "def helper(x):\n    return x + 1";
		const tree = parser.parse(source);
		const results = detectPythonFrameworks(tree, "src/util.py");
		expect(results.length).toBe(0);
	});

	it("detects multiple route handlers in one file", () => {
		const source = '@app.get("/a")\ndef a():\n    pass\n\n@app.post("/b")\ndef b():\n    pass';
		const tree = parser.parse(source);
		const results = detectPythonFrameworks(tree, "src/routes.py");
		expect(results.length).toBe(2);
	});
});
