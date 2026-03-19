import type { Node, NodeKind } from "../../types/graph.ts";
import type { TreeSitterNode, TreeSitterTree } from "../parser.ts";

/** Scope entry tracking the name and whether it's a class scope. */
type ScopeEntry = { readonly name: string; readonly isClass: boolean };

/**
 * Extracts symbols (functions, classes, methods) from a Python AST.
 *
 * @param tree - Parsed tree-sitter tree
 * @param filePath - Relative file path for node ID construction
 * @param _source - Original source text (unused but kept for interface consistency)
 * @returns Extracted nodes with deterministic IDs
 */
function extractPythonSymbols(
	tree: TreeSitterTree,
	filePath: string,
	_source: string,
): readonly Node[] {
	const nodes: Node[] = [];
	visitNode(tree.rootNode, filePath, [], nodes);
	return nodes;
}

/**
 * Recursively visits AST nodes to extract symbols.
 * Tracks parent scope for generating nested IDs (e.g., Class.method, outer.inner).
 */
function visitNode(
	node: TreeSitterNode,
	filePath: string,
	scopeStack: readonly ScopeEntry[],
	results: Node[],
): void {
	if (node.type === "decorated_definition") {
		// Decorated definitions wrap a function/class. Find the inner definition
		// and use the decorated_definition's line range (includes decorators).
		const inner = node.children.find(
			(c) => c.type === "function_definition" || c.type === "class_definition",
		);
		if (inner) {
			extractDefinition(inner, filePath, scopeStack, results, node);
		}
	} else if (node.type === "function_definition" || node.type === "class_definition") {
		extractDefinition(node, filePath, scopeStack, results, undefined);
	} else {
		for (const child of node.children) {
			visitNode(child, filePath, scopeStack, results);
		}
	}
}

/**
 * Extracts a function or class definition into a Node and recurses into its body.
 * If a decorated parent is provided, uses its line range to include decorator lines.
 */
function extractDefinition(
	node: TreeSitterNode,
	filePath: string,
	scopeStack: readonly ScopeEntry[],
	results: Node[],
	decoratedParent: TreeSitterNode | undefined,
): void {
	const nameNode = node.childForFieldName("name");
	if (!nameNode) return;

	const name = nameNode.text;
	const isClass = node.type === "class_definition";
	const kind = resolveKind(isClass, scopeStack);
	const qualifiedName = [...scopeStack.map((s) => s.name), name].join(".");
	const id = `${filePath}::${qualifiedName}`;

	const signature = kind !== "class" ? buildSignature(node, name) : undefined;

	// Use the decorated parent's line range if it exists (includes decorator lines)
	const rangeNode = decoratedParent ?? node;

	results.push({
		id,
		kind,
		name,
		file: filePath,
		lineStart: rangeNode.startPosition.row + 1,
		lineEnd: rangeNode.endPosition.row + 1,
		language: "python",
		signature,
		isTest: false,
		metadata: undefined,
	});

	// Recurse into children with updated scope
	const newScope: readonly ScopeEntry[] = [...scopeStack, { name, isClass }];
	for (const child of node.children) {
		visitNode(child, filePath, newScope, results);
	}
}

/** Determines the node kind based on whether this is a class or function, and the parent scope. */
function resolveKind(isClass: boolean, scopeStack: readonly ScopeEntry[]): NodeKind {
	if (isClass) return "class";
	// A function directly inside a class is a method
	const parentScope = scopeStack.at(-1);
	if (parentScope?.isClass) return "method";
	return "function";
}

/**
 * Builds a human-readable signature from a function definition node.
 * Includes parameter names with type annotations and return type.
 */
function buildSignature(node: TreeSitterNode, name: string): string {
	const paramsNode = node.childForFieldName("parameters");
	const returnTypeNode = node.childForFieldName("return_type");

	const params = paramsNode ? paramsNode.text : "()";
	const returnType = returnTypeNode ? ` -> ${returnTypeNode.text}` : "";

	return `${name}${params}${returnType}`;
}

export { extractPythonSymbols };
