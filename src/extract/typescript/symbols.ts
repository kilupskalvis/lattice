import type { Node, NodeKind } from "../../types/graph.ts";
import type { TreeSitterNode, TreeSitterTree } from "../parser.ts";

/**
 * Extracts symbols (functions, classes, methods, interfaces, type aliases)
 * from a TypeScript AST.
 *
 * @param tree - Parsed tree-sitter tree
 * @param filePath - Relative file path for node ID construction
 * @param _source - Original source text (unused, kept for interface consistency)
 * @returns Extracted nodes with deterministic IDs
 */
function extractTypeScriptSymbols(
	tree: TreeSitterTree,
	filePath: string,
	_source: string,
): readonly Node[] {
	const nodes: Node[] = [];
	visitNode(tree.rootNode, filePath, [], nodes);
	return nodes;
}

/** Scope entry for tracking parent context. */
type ScopeEntry = { readonly name: string; readonly isClass: boolean };

/** Recursively visits AST nodes to extract symbols. */
function visitNode(
	node: TreeSitterNode,
	filePath: string,
	scopeStack: readonly ScopeEntry[],
	results: Node[],
): void {
	switch (node.type) {
		case "function_declaration":
			extractFunction(node, filePath, scopeStack, results);
			return;
		case "class_declaration":
			extractClass(node, filePath, scopeStack, results);
			return;
		case "interface_declaration":
			extractTypeDecl(node, filePath, scopeStack, results, "type");
			return;
		case "type_alias_declaration":
			extractTypeDecl(node, filePath, scopeStack, results, "type");
			return;
		case "export_statement": {
			// Unwrap: export function X, export class X, export const X = ...
			for (const child of node.children) {
				visitNode(child, filePath, scopeStack, results);
			}
			return;
		}
		case "lexical_declaration": {
			// const handler = async () => { ... }
			extractArrowFunctions(node, filePath, scopeStack, results);
			return;
		}
		case "method_definition": {
			extractMethod(node, filePath, scopeStack, results);
			return;
		}
		default:
			for (const child of node.children) {
				visitNode(child, filePath, scopeStack, results);
			}
	}
}

/** Extracts a function declaration. */
function extractFunction(
	node: TreeSitterNode,
	filePath: string,
	scopeStack: readonly ScopeEntry[],
	results: Node[],
): void {
	const nameNode = node.childForFieldName("name");
	if (!nameNode) return;

	const name = nameNode.text;
	const qualifiedName = [...scopeStack.map((s) => s.name), name].join(".");
	const id = `${filePath}::${qualifiedName}`;

	results.push({
		id,
		kind: "function",
		name,
		file: filePath,
		lineStart: node.startPosition.row + 1,
		lineEnd: node.endPosition.row + 1,
		language: "typescript",
		signature: buildSignature(node, name),
		isTest: false,
		metadata: undefined,
	});
}

/** Extracts a class declaration and recurses into its body for methods. */
function extractClass(
	node: TreeSitterNode,
	filePath: string,
	scopeStack: readonly ScopeEntry[],
	results: Node[],
): void {
	const nameNode = node.childForFieldName("name");
	if (!nameNode) return;

	const name = nameNode.text;
	const qualifiedName = [...scopeStack.map((s) => s.name), name].join(".");
	const id = `${filePath}::${qualifiedName}`;

	results.push({
		id,
		kind: "class",
		name,
		file: filePath,
		lineStart: node.startPosition.row + 1,
		lineEnd: node.endPosition.row + 1,
		language: "typescript",
		signature: undefined,
		isTest: false,
		metadata: undefined,
	});

	// Recurse into class body for methods
	const body = node.childForFieldName("body");
	if (body) {
		const newScope = [...scopeStack, { name, isClass: true }];
		for (const child of body.children) {
			visitNode(child, filePath, newScope, results);
		}
	}
}

/** Extracts a method definition inside a class. */
function extractMethod(
	node: TreeSitterNode,
	filePath: string,
	scopeStack: readonly ScopeEntry[],
	results: Node[],
): void {
	const nameNode = node.childForFieldName("name");
	if (!nameNode) return;

	const name = nameNode.text;
	const qualifiedName = [...scopeStack.map((s) => s.name), name].join(".");
	const id = `${filePath}::${qualifiedName}`;

	results.push({
		id,
		kind: "method",
		name,
		file: filePath,
		lineStart: node.startPosition.row + 1,
		lineEnd: node.endPosition.row + 1,
		language: "typescript",
		signature: buildSignature(node, name),
		isTest: false,
		metadata: undefined,
	});
}

/** Extracts an interface or type alias declaration. */
function extractTypeDecl(
	node: TreeSitterNode,
	filePath: string,
	scopeStack: readonly ScopeEntry[],
	results: Node[],
	kind: NodeKind,
): void {
	const nameNode = node.childForFieldName("name");
	if (!nameNode) return;

	const name = nameNode.text;
	const qualifiedName = [...scopeStack.map((s) => s.name), name].join(".");
	const id = `${filePath}::${qualifiedName}`;

	results.push({
		id,
		kind,
		name,
		file: filePath,
		lineStart: node.startPosition.row + 1,
		lineEnd: node.endPosition.row + 1,
		language: "typescript",
		signature: undefined,
		isTest: false,
		metadata: undefined,
	});
}

/** Extracts arrow functions assigned to const/let variables. */
function extractArrowFunctions(
	node: TreeSitterNode,
	filePath: string,
	scopeStack: readonly ScopeEntry[],
	results: Node[],
): void {
	for (const child of node.children) {
		if (child.type === "variable_declarator") {
			const nameNode = child.childForFieldName("name");
			const valueNode = child.childForFieldName("value");
			if (nameNode && valueNode?.type === "arrow_function") {
				const name = nameNode.text;
				const qualifiedName = [...scopeStack.map((s) => s.name), name].join(".");
				const id = `${filePath}::${qualifiedName}`;

				results.push({
					id,
					kind: "function",
					name,
					file: filePath,
					lineStart: node.startPosition.row + 1,
					lineEnd: node.endPosition.row + 1,
					language: "typescript",
					signature: buildArrowSignature(valueNode, name),
					isTest: false,
					metadata: undefined,
				});
			}
		}
	}
}

/** Builds a signature string from a function/method declaration. */
function buildSignature(node: TreeSitterNode, name: string): string {
	const params = node.childForFieldName("parameters");
	const returnType =
		node.childForFieldName("return_type") ??
		node.children.find((c) => c.type === "type_annotation");

	const paramsStr = params?.text ?? "()";
	const returnStr = returnType?.text ?? "";

	return `${name}${paramsStr}${returnStr ? ` ${returnStr}` : ""}`;
}

/** Builds a signature string from an arrow function. */
function buildArrowSignature(node: TreeSitterNode, name: string): string {
	const params =
		node.childForFieldName("parameters") ??
		node.children.find((c) => c.type === "formal_parameters");
	const returnType =
		node.childForFieldName("return_type") ??
		node.children.find((c) => c.type === "type_annotation");

	const paramsStr = params?.text ?? "()";
	const returnStr = returnType?.text ?? "";

	return `${name}${paramsStr}${returnStr ? ` ${returnStr}` : ""}`;
}

export { extractTypeScriptSymbols };
