import type { TreeSitterNode, TreeSitterTree } from "../parser.ts";

/** A parsed import statement from TypeScript source. */
type TypeScriptImport = {
	readonly module: string;
	readonly names: readonly string[];
	readonly defaultImport: string | undefined;
	readonly isRelative: boolean;
	readonly line: number;
};

/**
 * Extracts import statements from a TypeScript AST.
 *
 * @param tree - Parsed tree-sitter tree
 * @param _filePath - Relative file path (unused, kept for interface consistency)
 * @returns Parsed imports with module paths and imported names
 */
function extractTypeScriptImports(
	tree: TreeSitterTree,
	_filePath: string,
): readonly TypeScriptImport[] {
	const imports: TypeScriptImport[] = [];

	for (const child of tree.rootNode.children) {
		if (child.type === "import_statement") {
			parseImportStatement(child, imports);
		}
	}

	return imports;
}

/** Parses an import statement into module path, named imports, and default import. */
function parseImportStatement(node: TreeSitterNode, results: TypeScriptImport[]): void {
	const fromClause = node.children.find((c) => c.type === "string");
	if (!fromClause) return;

	const contentNode = fromClause.children.find((c) => c.type === "string_fragment");
	const module = contentNode?.text ?? "";
	const isRelative = module.startsWith(".");

	const importClause = node.children.find((c) => c.type === "import_clause");
	if (!importClause) return;

	let defaultImport: string | undefined;
	const names: string[] = [];

	for (const child of importClause.children) {
		if (child.type === "identifier") {
			defaultImport = child.text;
		} else if (child.type === "named_imports") {
			for (const spec of child.children) {
				if (spec.type === "import_specifier") {
					const nameNode = spec.childForFieldName("name");
					if (nameNode) names.push(nameNode.text);
				}
			}
		}
	}

	results.push({
		module,
		names,
		defaultImport,
		isRelative,
		line: node.startPosition.row + 1,
	});
}

export { extractTypeScriptImports, type TypeScriptImport };
