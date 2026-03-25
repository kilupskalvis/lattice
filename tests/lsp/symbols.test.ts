import { describe, expect, test } from "bun:test";
import { documentSymbolsToNodes } from "../../src/lsp/symbols.ts";
import { type DocumentSymbol, SymbolKind } from "../../src/lsp/types.ts";

describe("documentSymbolsToNodes", () => {
	test("converts top-level functions", () => {
		const symbols: DocumentSymbol[] = [
			{
				name: "greet",
				kind: SymbolKind.Function,
				range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
				selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 14 } },
			},
		];
		const nodes = documentSymbolsToNodes(symbols, "src/main.ts", "typescript", false);
		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.id).toBe("src/main.ts::greet");
		expect(nodes[0]?.kind).toBe("function");
		expect(nodes[0]?.lineStart).toBe(1);
		expect(nodes[0]?.lineEnd).toBe(3);
	});

	test("converts class with methods using qualified names", () => {
		const symbols: DocumentSymbol[] = [
			{
				name: "MyClass",
				kind: SymbolKind.Class,
				range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
				selectionRange: {
					start: { line: 0, character: 6 },
					end: { line: 0, character: 13 },
				},
				children: [
					{
						name: "myMethod",
						kind: SymbolKind.Method,
						range: {
							start: { line: 2, character: 2 },
							end: { line: 5, character: 3 },
						},
						selectionRange: {
							start: { line: 2, character: 2 },
							end: { line: 2, character: 10 },
						},
					},
				],
			},
		];
		const nodes = documentSymbolsToNodes(symbols, "src/service.ts", "typescript", false);
		expect(nodes).toHaveLength(2);
		expect(nodes.find((n) => n.name === "myMethod")?.id).toBe("src/service.ts::MyClass.myMethod");
	});

	test("converts interfaces as type nodes", () => {
		const symbols: DocumentSymbol[] = [
			{
				name: "MyInterface",
				kind: SymbolKind.Interface,
				range: { start: { line: 0, character: 0 }, end: { line: 3, character: 1 } },
				selectionRange: {
					start: { line: 0, character: 10 },
					end: { line: 0, character: 21 },
				},
			},
		];
		const nodes = documentSymbolsToNodes(symbols, "src/types.ts", "typescript", false);
		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.kind).toBe("type");
	});

	test("skips variables but preserves children", () => {
		const symbols: DocumentSymbol[] = [
			{
				name: "myVar",
				kind: SymbolKind.Variable,
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
				selectionRange: {
					start: { line: 0, character: 6 },
					end: { line: 0, character: 11 },
				},
			},
		];
		const nodes = documentSymbolsToNodes(symbols, "src/main.ts", "typescript", false);
		expect(nodes).toHaveLength(0);
	});

	test("converts Go structs as class nodes", () => {
		const symbols: DocumentSymbol[] = [
			{
				name: "Server",
				kind: SymbolKind.Struct,
				range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
				selectionRange: { start: { line: 0, character: 5 }, end: { line: 0, character: 11 } },
				children: [
					{
						name: "Handle",
						kind: SymbolKind.Method,
						range: { start: { line: 3, character: 0 }, end: { line: 6, character: 1 } },
						selectionRange: {
							start: { line: 3, character: 16 },
							end: { line: 3, character: 22 },
						},
					},
				],
			},
		];
		const nodes = documentSymbolsToNodes(symbols, "server.go", "go", false);
		expect(nodes).toHaveLength(2);
		expect(nodes[0]?.kind).toBe("class");
		expect(nodes[0]?.name).toBe("Server");
		expect(nodes[1]?.id).toBe("server.go::Server.Handle");
		expect(nodes[1]?.kind).toBe("method");
	});

	test("deduplicates init() functions in Go", () => {
		const symbols: DocumentSymbol[] = [
			{
				name: "init",
				kind: SymbolKind.Function,
				range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
				selectionRange: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } },
			},
			{
				name: "init",
				kind: SymbolKind.Function,
				range: { start: { line: 4, character: 0 }, end: { line: 6, character: 1 } },
				selectionRange: { start: { line: 4, character: 5 }, end: { line: 4, character: 9 } },
			},
		];
		const nodes = documentSymbolsToNodes(symbols, "main.go", "go", false);
		expect(nodes).toHaveLength(2);
		expect(nodes[0]?.id).toBe("main.go::init");
		expect(nodes[1]?.id).toBe("main.go::init$2");
	});

	test("marks test files", () => {
		const symbols: DocumentSymbol[] = [
			{
				name: "testFn",
				kind: SymbolKind.Function,
				range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
				selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } },
			},
		];
		const nodes = documentSymbolsToNodes(symbols, "tests/main.test.ts", "typescript", true);
		expect(nodes[0]?.isTest).toBe(true);
	});
});
