/**
 * Shared tree-sitter parser initialization.
 * Uses web-tree-sitter with WASM grammars from tree-sitter-wasms.
 */

// web-tree-sitter 0.24.x uses CJS exports
// biome-ignore lint/suspicious/noExplicitAny: web-tree-sitter 0.24 has no ESM types
const TreeSitter = require("web-tree-sitter") as any;

type TreeSitterParser = {
	setLanguage(lang: TreeSitterLanguage): void;
	parse(input: string): TreeSitterTree;
};

type TreeSitterLanguage = {
	readonly version: number;
};

type TreeSitterTree = {
	readonly rootNode: TreeSitterNode;
};

type TreeSitterNode = {
	readonly type: string;
	readonly text: string;
	readonly startPosition: { row: number; column: number };
	readonly endPosition: { row: number; column: number };
	readonly startIndex: number;
	readonly endIndex: number;
	readonly childCount: number;
	readonly children: readonly TreeSitterNode[];
	readonly parent: TreeSitterNode | null;
	readonly firstChild: TreeSitterNode | null;
	readonly lastChild: TreeSitterNode | null;
	readonly nextSibling: TreeSitterNode | null;
	readonly previousSibling: TreeSitterNode | null;
	childForFieldName(fieldName: string): TreeSitterNode | null;
	childrenForFieldName(fieldName: string): readonly TreeSitterNode[];
	descendantsOfType(type: string | readonly string[]): readonly TreeSitterNode[];
};

let initialized = false;
const languageCache = new Map<string, TreeSitterLanguage>();

/**
 * Resolves the WASM file path for a language grammar.
 * Tries multiple locations to support both dev and compiled binary modes:
 * 1. Relative to this source file (dev: bun src/main.ts)
 * 2. Relative to the compiled binary (binary: ./lattice)
 * 3. Relative to CWD (when node_modules exists in working dir)
 */
function grammarPath(language: string): string {
	const { existsSync } = require("node:fs");
	const { dirname, join } = require("node:path");
	const filename = `tree-sitter-${language}.wasm`;
	const subpath = `node_modules/tree-sitter-wasms/out/${filename}`;

	// Try relative to this source file (dev mode)
	const packageRoot = new URL("../../", import.meta.url).pathname;
	const devPath = join(packageRoot, subpath);
	if (existsSync(devPath)) return devPath;

	// Try relative to the binary's location (compiled mode)
	const binDir = dirname(process.execPath);
	const binPath = join(binDir, subpath);
	if (existsSync(binPath)) return binPath;

	// Try relative to CWD
	const cwdPath = join(process.cwd(), subpath);
	if (existsSync(cwdPath)) return cwdPath;

	// Fall back — will produce a clear error
	return devPath;
}

/**
 * Initializes tree-sitter WASM runtime. Must be called once before parsing.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
async function initTreeSitter(): Promise<void> {
	if (initialized) return;
	await TreeSitter.init();
	initialized = true;
}

/**
 * Creates a parser configured for the given language.
 *
 * @param language - Language name matching the WASM grammar file (e.g., "python", "typescript")
 * @returns A configured parser ready to parse source code
 */
async function createParser(language: string): Promise<TreeSitterParser> {
	await initTreeSitter();

	const cached = languageCache.get(language);
	const lang = cached ?? (await loadAndCacheLanguage(language));

	const parser = new TreeSitter();
	parser.setLanguage(lang);
	return parser as TreeSitterParser;
}

/** Loads a language grammar from WASM and caches it. */
async function loadAndCacheLanguage(language: string): Promise<TreeSitterLanguage> {
	const lang = (await TreeSitter.Language.load(grammarPath(language))) as TreeSitterLanguage;
	languageCache.set(language, lang);
	return lang;
}

export {
	createParser,
	initTreeSitter,
	type TreeSitterLanguage,
	type TreeSitterNode,
	type TreeSitterParser,
	type TreeSitterTree,
};
