import { describe, expect, test } from "bun:test";
import { extractPackageName, outgoingCallsToEdges } from "../../src/lsp/calls.ts";
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
		const result = outgoingCallsToEdges("src/main.ts::greet", calls, projectRoot);
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
		const result = outgoingCallsToEdges("src/pay.ts::charge", calls, projectRoot);
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
		const result = outgoingCallsToEdges("src/io.ts::load", calls, projectRoot);
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
