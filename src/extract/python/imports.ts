import type { TreeSitterNode, TreeSitterTree } from "../parser.ts";

/** A parsed import statement from Python source. */
type PythonImport = {
	readonly module: string;
	readonly names: readonly string[];
	readonly isRelative: boolean;
	readonly aliases: Map<string, string> | undefined;
	readonly line: number;
};

/**
 * Extracts import statements from a Python AST.
 *
 * @param tree - Parsed tree-sitter tree
 * @param _filePath - Relative file path (unused, kept for interface consistency)
 * @returns Parsed imports with module paths, imported names, and alias mappings
 */
function extractPythonImports(tree: TreeSitterTree, _filePath: string): readonly PythonImport[] {
	const imports: PythonImport[] = [];

	for (const child of tree.rootNode.children) {
		if (child.type === "import_statement") {
			parseImportStatement(child, imports);
		} else if (child.type === "import_from_statement") {
			parseImportFromStatement(child, imports);
		}
	}

	return imports;
}

/** Parses `import x` or `import x as y` statements. */
function parseImportStatement(node: TreeSitterNode, results: PythonImport[]): void {
	for (const child of node.children) {
		if (child.type === "dotted_name") {
			results.push({
				module: child.text,
				names: [],
				isRelative: false,
				aliases: undefined,
				line: node.startPosition.row + 1,
			});
		} else if (child.type === "aliased_import") {
			const moduleName = extractDottedName(child);
			const alias = extractAlias(child);
			const aliases = alias ? new Map([[moduleName, alias]]) : undefined;
			results.push({
				module: moduleName,
				names: [],
				isRelative: false,
				aliases,
				line: node.startPosition.row + 1,
			});
		}
	}
}

/** Parses `from x import y` or `from .x import y as z` statements. */
function parseImportFromStatement(node: TreeSitterNode, results: PythonImport[]): void {
	let module = "";
	let isRelative = false;
	const names: string[] = [];
	const aliases = new Map<string, string>();

	for (const child of node.children) {
		if (child.type === "dotted_name" && !module) {
			module = child.text;
		} else if (child.type === "relative_import") {
			isRelative = true;
			const prefix = child.children.find((c) => c.type === "import_prefix");
			const dottedName = child.children.find((c) => c.type === "dotted_name");
			const dots = prefix?.text ?? ".";
			module = dottedName ? `${dots}${dottedName.text}` : dots;
		} else if (child.type === "dotted_name" && module) {
			names.push(child.text);
		} else if (child.type === "aliased_import") {
			const name = extractDottedName(child);
			names.push(name);
			const alias = extractAlias(child);
			if (alias) {
				aliases.set(name, alias);
			}
		}
	}

	results.push({
		module,
		names,
		isRelative,
		aliases: aliases.size > 0 ? aliases : undefined,
		line: node.startPosition.row + 1,
	});
}

/** Extracts the dotted name from an aliased_import node. */
function extractDottedName(aliasedNode: TreeSitterNode): string {
	const dottedName = aliasedNode.children.find((c) => c.type === "dotted_name");
	return dottedName?.text ?? "";
}

/** Extracts the alias identifier from an aliased_import node. */
function extractAlias(aliasedNode: TreeSitterNode): string | undefined {
	const children = aliasedNode.children;
	const asIdx = children.findIndex((c) => c.type === "as");
	if (asIdx >= 0) {
		const aliasNode = children[asIdx + 1];
		if (aliasNode?.type === "identifier") {
			return aliasNode.text;
		}
	}
	return undefined;
}

export { extractPythonImports, type PythonImport };
