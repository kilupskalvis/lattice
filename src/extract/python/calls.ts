import type { TreeSitterNode, TreeSitterTree } from "../parser.ts";

/** A raw call detected in the AST before resolution to graph edges. */
type RawCall = {
	readonly sourceId: string;
	readonly callee: string;
	readonly line: number;
};

/**
 * Extracts function calls from a Python AST.
 * Each call is scoped to its enclosing function or method.
 *
 * @param tree - Parsed tree-sitter tree
 * @param filePath - Relative file path for source ID construction
 * @returns Raw calls with caller ID and callee expression
 */
function extractPythonCalls(tree: TreeSitterTree, filePath: string): readonly RawCall[] {
	const calls: RawCall[] = [];
	visitForCalls(tree.rootNode, filePath, [], calls);
	return calls;
}

/** Scope entry for tracking the enclosing function/class context. */
type ScopeEntry = { readonly name: string };

/**
 * Recursively walks the AST to find call expressions inside function bodies.
 * Tracks the enclosing function scope to produce correct source IDs.
 */
function visitForCalls(
	node: TreeSitterNode,
	filePath: string,
	scopeStack: readonly ScopeEntry[],
	results: RawCall[],
): void {
	// Enter a new scope for function/class definitions
	if (node.type === "function_definition" || node.type === "class_definition") {
		const nameNode = node.childForFieldName("name");
		if (nameNode) {
			const newScope = [...scopeStack, { name: nameNode.text }];
			for (const child of node.children) {
				visitForCalls(child, filePath, newScope, results);
			}
			return;
		}
	}

	// Handle decorated definitions — unwrap to the inner definition
	if (node.type === "decorated_definition") {
		for (const child of node.children) {
			if (child.type === "function_definition" || child.type === "class_definition") {
				visitForCalls(child, filePath, scopeStack, results);
			}
		}
		return;
	}

	// Detect call expressions inside a function scope
	if (node.type === "call" && scopeStack.length > 0) {
		const callee = extractCalleeName(node);
		if (callee) {
			const sourceId = `${filePath}::${scopeStack.map((s) => s.name).join(".")}`;
			results.push({
				sourceId,
				callee,
				line: node.startPosition.row + 1,
			});
		}
	}

	// Recurse into children
	for (const child of node.children) {
		visitForCalls(child, filePath, scopeStack, results);
	}
}

/**
 * Extracts the callee name from a call node.
 * Handles: simple calls (foo()), attribute calls (obj.method()), chained calls (a.b.c()).
 */
function extractCalleeName(callNode: TreeSitterNode): string | undefined {
	const funcNode = callNode.children[0];
	if (!funcNode) return undefined;

	if (funcNode.type === "identifier") {
		return funcNode.text;
	}

	if (funcNode.type === "attribute") {
		return flattenAttribute(funcNode);
	}

	return undefined;
}

/**
 * Flattens a nested attribute access into a dotted string.
 * e.g., attribute(attribute(identifier("stripe"), "charges"), "create") → "stripe.charges.create"
 */
function flattenAttribute(node: TreeSitterNode): string {
	const parts: string[] = [];
	let current: TreeSitterNode | null = node;

	while (current?.type === "attribute") {
		const attrName = current.children.at(-1);
		if (attrName?.type === "identifier") {
			parts.unshift(attrName.text);
		}
		current = current.children[0] ?? null;
	}

	// The leftmost part is an identifier
	if (current?.type === "identifier") {
		parts.unshift(current.text);
	}

	return parts.join(".");
}

export { extractPythonCalls, type RawCall };
