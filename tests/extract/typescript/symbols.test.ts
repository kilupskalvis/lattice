import { beforeAll, describe, expect, it } from "bun:test";
import {
	createParser,
	initTreeSitter,
	type TreeSitterParser,
} from "../../../src/extract/parser.ts";
import { extractTypeScriptSymbols } from "../../../src/extract/typescript/symbols.ts";

let parser: TreeSitterParser;

beforeAll(async () => {
	await initTreeSitter();
	parser = await createParser("typescript");
});

describe("extractTypeScriptSymbols", () => {
	it("extracts a function declaration", () => {
		const source = "function fetchUser(id: number): Promise<User> { return db.get(id); }";
		const tree = parser.parse(source);
		const nodes = extractTypeScriptSymbols(tree, "src/svc.ts", source);
		expect(nodes.length).toBe(1);
		expect(nodes[0]?.name).toBe("fetchUser");
		expect(nodes[0]?.kind).toBe("function");
		expect(nodes[0]?.id).toBe("src/svc.ts::fetchUser");
		expect(nodes[0]?.language).toBe("typescript");
	});

	it("extracts function signature with types", () => {
		const source =
			"export async function charge(amount: number, token: string): Promise<Result> { }";
		const tree = parser.parse(source);
		const nodes = extractTypeScriptSymbols(tree, "src/pay.ts", source);
		const fn = nodes.find((n) => n.name === "charge");
		expect(fn?.signature).toContain("charge");
		expect(fn?.signature).toContain("amount: number");
		expect(fn?.signature).toContain("Promise<Result>");
	});

	it("extracts arrow function assigned to const", () => {
		const source =
			"export const handler = async (req: Request): Promise<Response> => { return new Response(); };";
		const tree = parser.parse(source);
		const nodes = extractTypeScriptSymbols(tree, "src/routes.ts", source);
		expect(nodes.length).toBe(1);
		expect(nodes[0]?.name).toBe("handler");
		expect(nodes[0]?.kind).toBe("function");
	});

	it("extracts class and its methods", () => {
		const source =
			"class UserService {\n  async getUser(id: number): Promise<User> { return this.db.get(id); }\n  createUser(data: unknown): User { return {} as User; }\n}";
		const tree = parser.parse(source);
		const nodes = extractTypeScriptSymbols(tree, "src/svc.ts", source);

		const cls = nodes.find((n) => n.name === "UserService");
		expect(cls).toBeDefined();
		expect(cls?.kind).toBe("class");

		const getUser = nodes.find((n) => n.name === "getUser");
		expect(getUser).toBeDefined();
		expect(getUser?.kind).toBe("method");
		expect(getUser?.id).toBe("src/svc.ts::UserService.getUser");
	});

	it("extracts interface", () => {
		const source = "interface Config {\n  port: number;\n  host: string;\n}";
		const tree = parser.parse(source);
		const nodes = extractTypeScriptSymbols(tree, "src/types.ts", source);
		expect(nodes.length).toBe(1);
		expect(nodes[0]?.name).toBe("Config");
		expect(nodes[0]?.kind).toBe("type");
	});

	it("extracts type alias", () => {
		const source = "type Result<T> = { ok: true; data: T } | { ok: false; error: string };";
		const tree = parser.parse(source);
		const nodes = extractTypeScriptSymbols(tree, "src/types.ts", source);
		expect(nodes.length).toBe(1);
		expect(nodes[0]?.name).toBe("Result");
		expect(nodes[0]?.kind).toBe("type");
	});

	it("extracts exported function", () => {
		const source = "export function doSomething(): void { }";
		const tree = parser.parse(source);
		const nodes = extractTypeScriptSymbols(tree, "src/util.ts", source);
		expect(nodes.length).toBe(1);
		expect(nodes[0]?.name).toBe("doSomething");
	});

	it("handles empty file", () => {
		const tree = parser.parse("");
		const nodes = extractTypeScriptSymbols(tree, "src/empty.ts", "");
		expect(nodes.length).toBe(0);
	});

	it("extracts multiple functions", () => {
		const source = "function a(): void { }\nfunction b(): void { }";
		const tree = parser.parse(source);
		const nodes = extractTypeScriptSymbols(tree, "src/multi.ts", source);
		expect(nodes.filter((n) => n.kind === "function").length).toBe(2);
	});
});
