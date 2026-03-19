import type { Edge, ExtractionResult, Tag } from "../../types/graph.ts";
import { isOk, unwrap } from "../../types/result.ts";
import type { Extractor } from "../extractor.ts";
import { createParser, type TreeSitterParser } from "../parser.ts";
import { parseTags } from "../tags.ts";
import { extractTypeScriptCalls } from "./calls.ts";
import { extractTypeScriptSymbols } from "./symbols.ts";

/**
 * Creates a TypeScript extractor with an initialized tree-sitter parser.
 * Must be called after initTreeSitter().
 *
 * @returns An Extractor configured for TypeScript source files
 */
async function createTypeScriptExtractor(): Promise<Extractor> {
	const parser = await createParser("typescript");

	return {
		language: "typescript",
		fileExtensions: [".ts", ".tsx"],
		extract: (filePath: string, source: string): Promise<ExtractionResult> =>
			extractTypeScript(parser, filePath, source),
	};
}

/**
 * Extracts symbols, calls, and tags from a TypeScript file.
 *
 * @param parser - Initialized tree-sitter parser for TypeScript
 * @param filePath - Relative file path
 * @param source - Raw source code
 * @returns Complete extraction result
 */
async function extractTypeScript(
	parser: TreeSitterParser,
	filePath: string,
	source: string,
): Promise<ExtractionResult> {
	if (!source.trim()) {
		return { nodes: [], edges: [], tags: [], unresolved: [] };
	}

	const tree = parser.parse(source);

	// 1. Extract symbols
	const nodes = [...extractTypeScriptSymbols(tree, filePath, source)];

	// 2. Extract calls and convert to edges
	const rawCalls = extractTypeScriptCalls(tree, filePath);
	const edges: Edge[] = [];
	const nodeIds = new Set(nodes.map((n) => n.id));

	for (const call of rawCalls) {
		const targetId = resolveCalleeInFile(call.callee, filePath, nodeIds);
		if (targetId) {
			edges.push({ sourceId: call.sourceId, targetId, kind: "calls", certainty: "certain" });
		} else {
			edges.push({
				sourceId: call.sourceId,
				targetId: call.callee,
				kind: "calls",
				certainty: "uncertain",
			});
		}
	}

	// 3. Parse lattice tags from comments above functions
	const tags = extractTagsFromSource(source, nodes);

	return { nodes, edges, tags, unresolved: [] };
}

/** Resolves a callee name to a node ID within the same file. */
function resolveCalleeInFile(
	callee: string,
	filePath: string,
	nodeIds: Set<string>,
): string | undefined {
	const directId = `${filePath}::${callee}`;
	if (nodeIds.has(directId)) return directId;

	// this.method → try ClassName.method
	if (callee.startsWith("this.")) {
		const methodName = callee.slice(5);
		for (const id of nodeIds) {
			if (id.endsWith(`.${methodName}`) && id.startsWith(`${filePath}::`)) return id;
		}
	}

	return undefined;
}

/** Extracts lattice tags from comment blocks above functions. */
function extractTagsFromSource(
	source: string,
	nodes: readonly { readonly id: string; readonly lineStart: number }[],
): readonly Tag[] {
	const lines = source.split("\n");
	const tags: Tag[] = [];

	for (const node of nodes) {
		const commentLines: string[] = [];
		let lineIdx = node.lineStart - 2; // 1-based to 0-based
		while (lineIdx >= 0) {
			const line = lines[lineIdx]?.trim();
			if (!line) break;
			if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
				commentLines.unshift(line);
				lineIdx--;
			} else if (line.startsWith("@")) {
				lineIdx--;
			} else {
				break;
			}
		}

		if (commentLines.length === 0) continue;

		const parseResult = parseTags(commentLines.join("\n"));
		if (isOk(parseResult)) {
			for (const parsed of unwrap(parseResult)) {
				tags.push({ nodeId: node.id, kind: parsed.kind, value: parsed.value });
			}
		}
	}

	return tags;
}

export { createTypeScriptExtractor };
