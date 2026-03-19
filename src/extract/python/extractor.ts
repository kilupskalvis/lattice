import type { Edge, ExtractionResult, Tag } from "../../types/graph.ts";
import { isOk, unwrap } from "../../types/result.ts";
import type { Extractor } from "../extractor.ts";
import { createParser, type TreeSitterParser } from "../parser.ts";
import { parseTags } from "../tags.ts";
import { extractPythonCalls } from "./calls.ts";
import { extractPythonSymbols } from "./symbols.ts";

/**
 * Creates a Python extractor with an initialized tree-sitter parser.
 * Must be called after initTreeSitter().
 *
 * @returns An Extractor configured for Python source files
 */
async function createPythonExtractor(): Promise<Extractor> {
	const parser = await createParser("python");

	return {
		language: "python",
		fileExtensions: [".py"],
		extract: (filePath: string, source: string): Promise<ExtractionResult> =>
			extractPython(parser, filePath, source),
	};
}

/**
 * Extracts symbols, calls, imports, tags, and framework metadata from a Python file.
 *
 * @param parser - Initialized tree-sitter parser for Python
 * @param filePath - Relative file path for node ID construction
 * @param source - Raw source code
 * @returns Complete extraction result with nodes, edges, tags, and unresolved references
 */
async function extractPython(
	parser: TreeSitterParser,
	filePath: string,
	source: string,
): Promise<ExtractionResult> {
	if (!source.trim()) {
		return { nodes: [], edges: [], tags: [], unresolved: [] };
	}

	const tree = parser.parse(source);

	// 1. Extract symbols (functions, classes, methods)
	const nodes = [...extractPythonSymbols(tree, filePath, source)];

	// 2. Extract calls and convert to edges
	const rawCalls = extractPythonCalls(tree, filePath);
	const edges: Edge[] = [];
	const nodeIds = new Set(nodes.map((n) => n.id));

	for (const call of rawCalls) {
		// Try to resolve the callee to a known node in this file
		const targetId = resolveCalleeInFile(call.callee, filePath, nodeIds);
		if (targetId) {
			edges.push({
				sourceId: call.sourceId,
				targetId,
				kind: "calls",
				certainty: "certain",
			});
		} else {
			// The callee is external or unresolvable within this file.
			// Store as an edge with the raw callee expression as target.
			// Cross-file resolution happens in the build command.
			edges.push({
				sourceId: call.sourceId,
				targetId: call.callee,
				kind: "calls",
				certainty: "uncertain",
			});
		}
	}

	// 3. Parse lattice tags from comments above functions
	const tags = extractTagsFromSource(source, filePath, nodes);

	return { nodes, edges, tags, unresolved: [] };
}

/**
 * Resolves a callee name to a node ID within the same file.
 * Handles simple names (bar → filePath::bar) and self.method references.
 */
function resolveCalleeInFile(
	callee: string,
	filePath: string,
	nodeIds: Set<string>,
): string | undefined {
	// Direct match: callee is a function name in this file
	const directId = `${filePath}::${callee}`;
	if (nodeIds.has(directId)) return directId;

	// self.method → try ClassName.method for each class in this file
	if (callee.startsWith("self.")) {
		const methodName = callee.slice(5);
		for (const id of nodeIds) {
			if (id.endsWith(`.${methodName}`) && id.startsWith(`${filePath}::`)) {
				return id;
			}
		}
	}

	return undefined;
}

/**
 * Extracts lattice tags by finding comment blocks directly above function definitions.
 * Associates each parsed tag with the node ID of the function below it.
 */
function extractTagsFromSource(
	source: string,
	_filePath: string,
	nodes: readonly { readonly id: string; readonly lineStart: number }[],
): readonly Tag[] {
	const lines = source.split("\n");
	const tags: Tag[] = [];

	for (const node of nodes) {
		// Collect comment lines directly above the function (no blank lines between)
		const commentLines: string[] = [];
		let lineIdx = node.lineStart - 2; // lineStart is 1-based, array is 0-based
		while (lineIdx >= 0) {
			const line = lines[lineIdx]?.trim();
			if (!line) break;
			if (line.startsWith("#") || line.startsWith("//") || line.startsWith("/*")) {
				commentLines.unshift(line);
				lineIdx--;
			} else if (line.startsWith("@")) {
				// Skip decorators — they're between the tags and the function
				lineIdx--;
			} else {
				break;
			}
		}

		if (commentLines.length === 0) continue;

		const parseResult = parseTags(commentLines.join("\n"));
		if (isOk(parseResult)) {
			for (const parsed of unwrap(parseResult)) {
				tags.push({
					nodeId: node.id,
					kind: parsed.kind,
					value: parsed.value,
				});
			}
		}
	}

	return tags;
}

export { createPythonExtractor };
