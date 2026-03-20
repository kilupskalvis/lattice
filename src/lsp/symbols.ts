import type { Node, NodeKind } from "../types/graph.ts";
import { SymbolKind, type DocumentSymbol } from "./types.ts";

/**
 * Converts LSP DocumentSymbol responses into Lattice Node objects.
 * Flattens the hierarchy and builds qualified names (e.g., ClassName.methodName).
 *
 * @param symbols - DocumentSymbol array from LSP
 * @param filePath - Relative file path for node IDs
 * @param language - Language identifier
 * @param isTest - Whether this file is in a test directory
 * @returns Flat array of Lattice Nodes
 */
function documentSymbolsToNodes(
	symbols: readonly DocumentSymbol[],
	filePath: string,
	language: string,
	isTest: boolean,
): readonly Node[] {
	const nodes: Node[] = [];
	flattenSymbols(symbols, filePath, language, isTest, [], nodes);
	return nodes;
}

function flattenSymbols(
	symbols: readonly DocumentSymbol[],
	filePath: string,
	language: string,
	isTest: boolean,
	parentNames: readonly string[],
	results: Node[],
): void {
	for (const sym of symbols) {
		const kind = symbolKindToNodeKind(sym.kind);
		if (!kind) {
			// Still recurse into children for non-matching kinds (e.g., modules)
			if (sym.children) {
				flattenSymbols(sym.children, filePath, language, isTest, parentNames, results);
			}
			continue;
		}

		const qualifiedName = [...parentNames, sym.name].join(".");
		const id = `${filePath}::${qualifiedName}`;

		results.push({
			id,
			kind,
			name: sym.name,
			file: filePath,
			lineStart: sym.range.start.line + 1,
			lineEnd: sym.range.end.line + 1,
			language,
			signature: undefined,
			isTest,
			metadata: undefined,
		});

		if (sym.children) {
			flattenSymbols(
				sym.children,
				filePath,
				language,
				isTest,
				[...parentNames, sym.name],
				results,
			);
		}
	}
}

function symbolKindToNodeKind(kind: number): NodeKind | undefined {
	if (kind === SymbolKind.Function) return "function";
	if (kind === SymbolKind.Method) return "method";
	if (kind === SymbolKind.Constructor) return "method";
	if (kind === SymbolKind.Class) return "class";
	if (kind === SymbolKind.Interface) return "type";
	return undefined;
}

/** A Lattice Node paired with the LSP selectionRange position for call hierarchy queries. */
type NodeWithPosition = {
	readonly node: Node;
	readonly selectionLine: number;
	readonly selectionCharacter: number;
};

/**
 * Like documentSymbolsToNodes but also returns the selectionRange position
 * needed for prepareCallHierarchy requests.
 */
function documentSymbolsToNodesWithPositions(
	symbols: readonly DocumentSymbol[],
	filePath: string,
	language: string,
	isTest: boolean,
): readonly NodeWithPosition[] {
	const results: NodeWithPosition[] = [];
	flattenSymbolsWithPositions(symbols, filePath, language, isTest, [], results);
	return results;
}

function flattenSymbolsWithPositions(
	symbols: readonly DocumentSymbol[],
	filePath: string,
	language: string,
	isTest: boolean,
	parentNames: readonly string[],
	results: NodeWithPosition[],
): void {
	for (const sym of symbols) {
		const kind = symbolKindToNodeKind(sym.kind);
		if (!kind) {
			if (sym.children) {
				flattenSymbolsWithPositions(
					sym.children,
					filePath,
					language,
					isTest,
					parentNames,
					results,
				);
			}
			continue;
		}

		const qualifiedName = [...parentNames, sym.name].join(".");
		const id = `${filePath}::${qualifiedName}`;

		results.push({
			node: {
				id,
				kind,
				name: sym.name,
				file: filePath,
				lineStart: sym.range.start.line + 1,
				lineEnd: sym.range.end.line + 1,
				language,
				signature: undefined,
				isTest,
				metadata: undefined,
			},
			selectionLine: sym.selectionRange.start.line,
			selectionCharacter: sym.selectionRange.start.character,
		});

		if (sym.children) {
			flattenSymbolsWithPositions(
				sym.children,
				filePath,
				language,
				isTest,
				[...parentNames, sym.name],
				results,
			);
		}
	}
}

export { documentSymbolsToNodes, documentSymbolsToNodesWithPositions, type NodeWithPosition };
