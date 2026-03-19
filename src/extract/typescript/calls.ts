import type { TreeSitterNode, TreeSitterTree } from "../parser.ts";

/** A raw call detected in the TypeScript AST. */
type RawCall = {
	readonly sourceId: string;
	readonly callee: string;
	readonly line: number;
};

/**
 * Extracts function calls from a TypeScript AST.
 * Each call is scoped to its enclosing function, method, or arrow function.
 *
 * @param tree - Parsed tree-sitter tree
 * @param filePath - Relative file path for source ID construction
 * @returns Raw calls with caller ID and callee expression
 */
function extractTypeScriptCalls(tree: TreeSitterTree, filePath: string): readonly RawCall[] {
	const calls: RawCall[] = [];
	visitForCalls(tree.rootNode, filePath, [], calls);
	return calls;
}

type ScopeEntry = { readonly name: string };

/** Recursively walks the AST finding call_expression nodes inside functions. */
function visitForCalls(
	node: TreeSitterNode,
	filePath: string,
	scopeStack: readonly ScopeEntry[],
	results: RawCall[],
): void {
	// Enter new scope for function/method/class declarations
	if (
		node.type === "function_declaration" ||
		node.type === "method_definition" ||
		node.type === "class_declaration"
	) {
		const nameNode = node.childForFieldName("name");
		if (nameNode) {
			const newScope = [...scopeStack, { name: nameNode.text }];
			for (const child of node.children) {
				visitForCalls(child, filePath, newScope, results);
			}
			return;
		}
	}

	// Arrow function assigned to const
	if (node.type === "variable_declarator") {
		const nameNode = node.childForFieldName("name");
		const valueNode = node.childForFieldName("value");
		if (nameNode && valueNode?.type === "arrow_function") {
			const newScope = [...scopeStack, { name: nameNode.text }];
			for (const child of valueNode.children) {
				visitForCalls(child, filePath, newScope, results);
			}
			return;
		}
	}

	// Export statement — unwrap
	if (node.type === "export_statement") {
		for (const child of node.children) {
			visitForCalls(child, filePath, scopeStack, results);
		}
		return;
	}

	// Detect call expressions inside a function scope
	if (node.type === "call_expression" && scopeStack.length > 0) {
		const callee = extractCalleeName(node);
		if (callee) {
			const sourceId = `${filePath}::${scopeStack.map((s) => s.name).join(".")}`;
			results.push({ sourceId, callee, line: node.startPosition.row + 1 });
		}
	}

	for (const child of node.children) {
		visitForCalls(child, filePath, scopeStack, results);
	}
}

/** Extracts the callee name from a call_expression node. */
function extractCalleeName(callNode: TreeSitterNode): string | undefined {
	const funcNode = callNode.children[0];
	if (!funcNode) return undefined;
	if (funcNode.type === "identifier") return funcNode.text;
	if (funcNode.type === "member_expression") return flattenMemberExpression(funcNode);
	return undefined;
}

/** Flattens a.b.c member expression into "a.b.c". */
function flattenMemberExpression(node: TreeSitterNode): string {
	const parts: string[] = [];
	let current: TreeSitterNode | null = node;

	while (current?.type === "member_expression") {
		const prop = current.children.find((c) => c.type === "property_identifier");
		if (prop) parts.unshift(prop.text);
		current = current.children[0] ?? null;
	}

	if (current?.type === "identifier") parts.unshift(current.text);
	if (current?.type === "this") parts.unshift("this");

	return parts.join(".");
}

export { extractTypeScriptCalls, type RawCall };
