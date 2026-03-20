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

/** Options for building the graph. */
type BuildGraphOptions = {
	readonly projectRoot: string;
	readonly db: Database;
	readonly languages: readonly string[];
	readonly sourceRoots: readonly string[];
	readonly exclude: readonly string[];
	readonly testPaths: readonly string[];
	readonly lspCommand: string | undefined;
};

/** Statistics from a graph build. */
type BuildStats = {
	readonly fileCount: number;
	readonly nodeCount: number;
	readonly edgeCount: number;
	readonly tagCount: number;
	readonly durationMs: number;
};

/**
 * Builds the knowledge graph by querying an LSP server for symbols and call hierarchy,
 * scanning for @lattice: tags, and writing everything to SQLite.
 *
 * @param opts - Build configuration
 * @returns Build statistics
 */
async function buildGraph(opts: BuildGraphOptions): Promise<BuildStats> {
	const start = performance.now();
	const { projectRoot, db } = opts;

	const extensions = [".ts", ".tsx"];
	const allFiles: string[] = [];
	for (const srcRoot of opts.sourceRoots) {
		const absRoot = resolve(projectRoot, srcRoot);
		allFiles.push(...discoverFiles(absRoot, extensions, opts.exclude));
	}

	if (allFiles.length === 0) {
		return { fileCount: 0, nodeCount: 0, edgeCount: 0, tagCount: 0, durationMs: 0 };
	}

	const command = opts.lspCommand ?? "typescript-language-server";
	const args = opts.lspCommand ? [] : ["--stdio"];
	const client = await createLspClient({
		command,
		args,
		rootUri: `file://${projectRoot}`,
	});

	try {
		// Wait for server readiness using first file
		await client.waitForReady(allFiles[0] as string);

		const allNodes: Node[] = [];
		const allEdges: Edge[] = [];
		const allTags: Tag[] = [];
		const allExternalCalls: ExternalCall[] = [];

		for (const filePath of allFiles) {
			const relativePath = relative(projectRoot, filePath);
			const isTest = opts.testPaths.some((tp) => relativePath.startsWith(tp));
			const source = await Bun.file(filePath).text();

			const symbols = await client.documentSymbol(filePath);
			const nodesWithPos = documentSymbolsToNodesWithPositions(
				symbols,
				relativePath,
				"typescript",
				isTest,
			);
			const nodes = nodesWithPos.map((nwp) => nwp.node);
			allNodes.push(...nodes);

			// Get call edges for each function/method
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

			// Scan tags
			const { tags } = scanTags(source, nodes, "typescript");
			allTags.push(...tags);
		}

		insertNodes(db, allNodes);
		insertEdges(db, allEdges);
		insertTags(db, allTags);
		insertExternalCalls(db, allExternalCalls);
		synthesizeEventEdges(db);

		const durationMs = Math.round(performance.now() - start);
		return {
			fileCount: allFiles.length,
			nodeCount: allNodes.length,
			edgeCount: allEdges.length,
			tagCount: allTags.length,
			durationMs,
		};
	} finally {
		await client.shutdown();
	}
}

export { type BuildGraphOptions, type BuildStats, buildGraph };
