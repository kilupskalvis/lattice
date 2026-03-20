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
import { type NodeWithPosition, documentSymbolsToNodesWithPositions } from "./symbols.ts";

/** Strategy for extracting call edges from the LSP server. */
type EdgeStrategy = "outgoingCalls" | "references";

/** Per-language extraction configuration. */
type LanguageConfig = {
	readonly language: string;
	readonly extensions: readonly string[];
	readonly sourceRoots: readonly string[];
	readonly testPaths: readonly string[];
	readonly lspCommand: string;
	readonly lspArgs: readonly string[];
	readonly languageId: string;
	readonly edgeStrategy: EdgeStrategy;
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
	python: { command: "zubanls", args: [], languageId: "python" },
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

			// Phase 1: extract symbols and tags from all files
			type FileData = {
				filePath: string;
				relativePath: string;
				nodesWithPos: readonly NodeWithPosition[];
			};
			const fileDataList: FileData[] = [];

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

				const { tags } = scanTags(source, nodes, langConfig.language);
				allTags.push(...tags);

				fileDataList.push({ filePath, relativePath, nodesWithPos });
			}

			// Phase 2: extract edges using the configured strategy
			if (langConfig.edgeStrategy === "references") {
				// Build a lookup: for each file, sorted function ranges for mapping reference locations
				const nodesByFile = new Map<string, readonly Node[]>();
				for (const fd of fileDataList) {
					nodesByFile.set(
						fd.relativePath,
						fd.nodesWithPos
							.filter((nwp) => nwp.node.kind === "function" || nwp.node.kind === "method")
							.map((nwp) => nwp.node),
					);
				}

				// For each function/method, find who references it
				for (const fd of fileDataList) {
					for (const nwp of fd.nodesWithPos) {
						if (nwp.node.kind !== "function" && nwp.node.kind !== "method") continue;

						const refs = await client.references(
							fd.filePath,
							nwp.selectionLine,
							nwp.selectionCharacter,
						);

						for (const ref of refs) {
							const refFile = ref.uri.startsWith(`file://${projectRoot}/`)
								? ref.uri.slice(`file://${projectRoot}/`.length)
								: undefined;
							if (!refFile) continue;

							// Find which function contains this reference
							const fileFunctions = nodesByFile.get(refFile);
							if (!fileFunctions) continue;

							const refLine = ref.range.start.line + 1; // LSP 0-based → 1-based
							const caller = fileFunctions.find(
								(n) => refLine >= n.lineStart && refLine <= n.lineEnd,
							);
							if (!caller || caller.id === nwp.node.id) continue;

							allEdges.push({ sourceId: caller.id, targetId: nwp.node.id, kind: "calls" });
						}
					}
				}
			} else {
				// outgoingCalls strategy (TypeScript)
				for (const fd of fileDataList) {
					for (const nwp of fd.nodesWithPos) {
						if (nwp.node.kind !== "function" && nwp.node.kind !== "method") continue;

						const items = await client.prepareCallHierarchy(
							fd.filePath,
							nwp.selectionLine,
							nwp.selectionCharacter,
						);
						if (items.length === 0) continue;
						const item = items[0];
						if (!item) continue;

						const calls = await client.outgoingCalls(item);
						const { edges, externalCalls } = outgoingCallsToEdges(
							nwp.node.id,
							calls,
							projectRoot,
						);
						allEdges.push(...edges);
						allExternalCalls.push(...externalCalls);
					}
				}
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
		edgeStrategy: language === "python" ? "references" : "outgoingCalls",
	};
}

export {
	type BuildGraphOptions,
	type BuildStats,
	buildGraph,
	buildLanguageConfig,
	type LanguageConfig,
};
