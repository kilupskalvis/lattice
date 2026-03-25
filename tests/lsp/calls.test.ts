import { describe, expect, test } from "bun:test";
import {
	extractGoModuleName,
	extractPackageName,
	isTypeDeclaration,
	outgoingCallsToEdges,
} from "../../src/lsp/calls.ts";
import { type CallHierarchyOutgoingCall, SymbolKind } from "../../src/lsp/types.ts";

describe("outgoingCallsToEdges", () => {
	const projectRoot = "/project";

	test("converts internal calls to edges", () => {
		const calls: CallHierarchyOutgoingCall[] = [
			{
				to: {
					name: "helper",
					kind: SymbolKind.Function,
					uri: "file:///project/src/utils.ts",
					range: { start: { line: 5, character: 0 }, end: { line: 10, character: 1 } },
					selectionRange: {
						start: { line: 5, character: 9 },
						end: { line: 5, character: 15 },
					},
				},
				fromRanges: [{ start: { line: 2, character: 4 }, end: { line: 2, character: 10 } }],
			},
		];
		const result = outgoingCallsToEdges("src/main.ts::greet", calls, projectRoot, "typescript");
		expect(result.edges).toHaveLength(1);
		expect(result.edges[0]?.targetId).toBe("src/utils.ts::helper");
		expect(result.externalCalls).toHaveLength(0);
	});

	test("detects external calls via node_modules", () => {
		const calls: CallHierarchyOutgoingCall[] = [
			{
				to: {
					name: "create",
					kind: SymbolKind.Method,
					uri: "file:///project/node_modules/stripe/index.d.ts",
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
					selectionRange: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 6 },
					},
				},
				fromRanges: [],
			},
		];
		const result = outgoingCallsToEdges("src/pay.ts::charge", calls, projectRoot, "typescript");
		expect(result.edges).toHaveLength(0);
		expect(result.externalCalls).toHaveLength(1);
		expect(result.externalCalls[0]?.package).toBe("stripe");
		expect(result.externalCalls[0]?.symbol).toBe("create");
	});

	test("detects calls outside project root", () => {
		const calls: CallHierarchyOutgoingCall[] = [
			{
				to: {
					name: "readFile",
					kind: SymbolKind.Function,
					uri: "file:///usr/lib/node/fs.d.ts",
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
					selectionRange: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 8 },
					},
				},
				fromRanges: [],
			},
		];
		const result = outgoingCallsToEdges("src/io.ts::load", calls, projectRoot, "typescript");
		expect(result.edges).toHaveLength(0);
		expect(result.externalCalls).toHaveLength(0);
	});
});

describe("extractPackageName", () => {
	test("extracts simple package name", () => {
		expect(extractPackageName("file:///project/node_modules/stripe/index.d.ts")).toBe("stripe");
	});

	test("extracts scoped package name", () => {
		expect(extractPackageName("file:///project/node_modules/@anthropic-ai/sdk/index.d.ts")).toBe(
			"@anthropic-ai/sdk",
		);
	});

	test("returns undefined for non-node_modules path", () => {
		expect(extractPackageName("file:///usr/lib/something.ts")).toBeUndefined();
	});
});

describe("isTypeDeclaration", () => {
	test("allows library .d.ts stubs as real runtime deps", () => {
		expect(isTypeDeclaration("file:///project/node_modules/stripe/index.d.ts")).toBe(false);
	});

	test("detects @types packages", () => {
		expect(isTypeDeclaration("file:///project/node_modules/@types/node/index.d.ts")).toBe(true);
	});

	test("detects typescript package", () => {
		expect(isTypeDeclaration("file:///project/node_modules/typescript/lib/lib.es2022.d.ts")).toBe(
			true,
		);
	});

	test("detects bun-types package", () => {
		expect(isTypeDeclaration("file:///project/node_modules/bun-types/types.d.ts")).toBe(true);
	});

	test("returns false for runtime .ts files", () => {
		expect(isTypeDeclaration("file:///project/node_modules/stripe/lib/stripe.ts")).toBe(false);
	});

	test("skips type-only calls in outgoingCallsToEdges", () => {
		const calls: CallHierarchyOutgoingCall[] = [
			{
				to: {
					name: "Database",
					kind: SymbolKind.Class,
					uri: "file:///project/node_modules/bun-types/sqlite.d.ts",
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
					selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } },
				},
				fromRanges: [],
			},
		];
		const result = outgoingCallsToEdges("src/db.ts::open", calls, "/project", "typescript");
		expect(result.edges).toHaveLength(0);
		expect(result.externalCalls).toHaveLength(0);
	});
});

describe("extractGoModuleName", () => {
	test("extracts module from Go module cache path", () => {
		expect(
			extractGoModuleName("file:///Users/x/go/pkg/mod/github.com/gin-gonic/gin@v1.9.1/context.go"),
		).toBe("github.com/gin-gonic/gin");
	});

	test("extracts stdlib package from GOROOT", () => {
		expect(extractGoModuleName("file:///usr/local/go/src/fmt/print.go")).toBe("fmt");
	});

	test("extracts multi-segment stdlib package", () => {
		expect(extractGoModuleName("file:///usr/local/go/src/net/http/server.go")).toBe("net/http");
	});

	test("returns undefined for project-local path", () => {
		expect(extractGoModuleName("file:///project/src/main.go")).toBeUndefined();
	});
});

describe("outgoingCallsToEdges — Go", () => {
	const projectRoot = "/project";

	test("detects Go module cache external calls", () => {
		const calls: CallHierarchyOutgoingCall[] = [
			{
				to: {
					name: "New",
					kind: SymbolKind.Function,
					uri: "file:///Users/x/go/pkg/mod/github.com/gin-gonic/gin@v1.9.1/gin.go",
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
					selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
				},
				fromRanges: [],
			},
		];
		const result = outgoingCallsToEdges("main.go::main", calls, projectRoot, "go");
		expect(result.edges).toHaveLength(0);
		expect(result.externalCalls).toHaveLength(1);
		expect(result.externalCalls[0]?.package).toBe("github.com/gin-gonic/gin");
	});

	test("does not skip Go source files as type declarations", () => {
		const calls: CallHierarchyOutgoingCall[] = [
			{
				to: {
					name: "Println",
					kind: SymbolKind.Function,
					uri: "file:///usr/local/go/src/fmt/print.go",
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
					selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
				},
				fromRanges: [],
			},
		];
		const result = outgoingCallsToEdges("main.go::main", calls, projectRoot, "go");
		expect(result.externalCalls).toHaveLength(1);
		expect(result.externalCalls[0]?.package).toBe("fmt");
	});
});
