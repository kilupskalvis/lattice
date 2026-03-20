import type { Database } from "bun:sqlite";
import { relative, resolve } from "node:path";
import { scanTags } from "../extract/tag-scanner.ts";
import { discoverFiles } from "../files.ts";
import {
	insertEdges,
	insertExternalCalls,
	insertNodes,
	insertTags,
	synthesizeEventEdges,
} from "../graph/writer.ts";
import type { Edge, ExternalCall, Node, Tag } from "../types/graph.ts";
import { outgoingCallsToEdges } from "./calls.ts";
import { createLspClient } from "./client.ts";
import { documentSymbolsToNodesWithPositions } from "./symbols.ts";

/** Per-language extraction configuration. */
type LanguageConfig = {
	readonly language: string;
	readonly extensions: readonly string[];
	readonly sourceRoots: readonly string[];
	readonly testPaths: readonly string[];
	readonly lspCommand: string;
	readonly lspArgs: readonly string[];
	readonly languageId: string;
};

/** Options for building the graph. */
type BuildGraphOptions = {
	readonly projectRoot: string;
	readonly db: Database;
	readonly languageConfigs: readonly LanguageConfig[];
	readonly exclude: readonly string[];
};

/** Statistics from a graph build. */
type BuildStats = {
	readonly fileCount: number;
	readonly nodeCount: number;
	readonly edgeCount: number;
	readonly tagCount: number;
	readonly durationMs: number;
};

/** Default LSP server commands per language. */
const DEFAULT_LSP: Record<
	string,
	{ command: string; args: readonly string[]; languageId: string }
> = {
	typescript: {
		command: "typescript-language-server",
		args: ["--stdio"],
		languageId: "typescript",
	},
	python: { command: "pyright-langserver", args: ["--stdio"], languageId: "python" },
};

/**
 * Builds the knowledge graph by querying LSP servers for symbols and call hierarchy,
 * scanning for @lattice: tags, and writing everything to SQLite.
 * Spawns one LSP server per language.
 *
 * @param opts - Build configuration
 * @returns Build statistics
 */
async function buildGraph(opts: BuildGraphOptions): Promise<BuildStats> {
	const start = performance.now();
	const { projectRoot, db } = opts;

	let totalFiles = 0;
	const allNodes: Node[] = [];
	const allEdges: Edge[] = [];
	const allTags: Tag[] = [];
	const allExternalCalls: ExternalCall[] = [];

	for (const langConfig of opts.languageConfigs) {
		const files: string[] = [];
		for (const srcRoot of langConfig.sourceRoots) {
			const absRoot = resolve(projectRoot, srcRoot);
			files.push(...discoverFiles(absRoot, langConfig.extensions, opts.exclude));
		}

		if (files.length === 0) continue;
		totalFiles += files.length;

		const client = await createLspClient({
			command: langConfig.lspCommand,
			args: [...langConfig.lspArgs],
			rootUri: `file://${projectRoot}`,
			languageId: langConfig.languageId,
		});

		try {
			await client.waitForReady(files[0] as string);

			for (const filePath of files) {
				const relativePath = relative(projectRoot, filePath);
				const isTest = langConfig.testPaths.some((tp) => relativePath.startsWith(tp));
				const source = await Bun.file(filePath).text();

				const symbols = await client.documentSymbol(filePath);
				const nodesWithPos = documentSymbolsToNodesWithPositions(
					symbols,
					relativePath,
					langConfig.language,
					isTest,
				);
				const nodes = nodesWithPos.map((nwp) => nwp.node);
				allNodes.push(...nodes);

				for (const nwp of nodesWithPos) {
					if (nwp.node.kind !== "function" && nwp.node.kind !== "method") continue;

					const items = await client.prepareCallHierarchy(
						filePath,
						nwp.selectionLine,
						nwp.selectionCharacter,
					);
					if (items.length === 0) continue;
					const item = items[0];
					if (!item) continue;

					const calls = await client.outgoingCalls(item);
					const { edges, externalCalls } = outgoingCallsToEdges(nwp.node.id, calls, projectRoot);
					allEdges.push(...edges);
					allExternalCalls.push(...externalCalls);
				}

				const { tags } = scanTags(source, nodes, langConfig.language);
				allTags.push(...tags);
			}
		} finally {
			await client.shutdown();
		}
	}

	insertNodes(db, allNodes);
	insertEdges(db, allEdges);
	insertTags(db, allTags);
	insertExternalCalls(db, allExternalCalls);
	synthesizeEventEdges(db);

	const durationMs = Math.round(performance.now() - start);
	return {
		fileCount: totalFiles,
		nodeCount: allNodes.length,
		edgeCount: allEdges.length,
		tagCount: allTags.length,
		durationMs,
	};
}

/**
 * Builds a LanguageConfig from a language name and config sections.
 * Uses sensible defaults for LSP commands.
 */
function buildLanguageConfig(
	language: string,
	sourceRoots: readonly string[],
	testPaths: readonly string[],
	lspCommand: string | undefined,
): LanguageConfig {
	const defaults = DEFAULT_LSP[language];
	const extensions = language === "python" ? [".py"] : [".ts", ".tsx"];

	return {
		language,
		extensions,
		sourceRoots,
		testPaths,
		lspCommand: lspCommand ?? defaults?.command ?? language,
		lspArgs: lspCommand ? [] : (defaults?.args ?? []),
		languageId: defaults?.languageId ?? language,
	};
}

export {
	type BuildGraphOptions,
	type BuildStats,
	buildGraph,
	buildLanguageConfig,
	type LanguageConfig,
};
