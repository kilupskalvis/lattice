import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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
import { documentSymbolsToNodesWithPositions, type NodeWithPosition } from "./symbols.ts";

/** Per-language extraction configuration. */
type LanguageConfig = {
	readonly language: string;
	readonly extensions: readonly string[];
	readonly sourceRoots: readonly string[];
	readonly testPaths: readonly string[];
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

const VENDOR_VENV = join(import.meta.dir, "..", "..", "vendor", "venv");

/** Resolves the LSP server binary for a language. Auto-installs zuban on first use. */
function resolveLspServer(
	language: string,
): { command: string; args: readonly string[]; languageId: string } | undefined {
	if (language === "typescript") {
		const bundled = join(
			import.meta.dir,
			"..",
			"..",
			"node_modules",
			".bin",
			"typescript-language-server",
		);
		const command = existsSync(bundled) ? bundled : "typescript-language-server";
		return { command, args: ["--stdio"], languageId: "typescript" };
	}
	if (language === "python") {
		const zubanls = resolveZuban();
		if (!zubanls) return undefined;
		return { command: zubanls, args: [], languageId: "python" };
	}
	return undefined;
}

/** Finds or installs zubanls. Returns the binary path, or undefined if installation fails. */
function resolveZuban(): string | undefined {
	const isWindows = process.platform === "win32";
	const binDir = isWindows ? "Scripts" : "bin";
	const binName = isWindows ? "zubanls.exe" : "zubanls";

	// 1. Check vendored venv (installed by a previous build)
	const vendored = join(VENDOR_VENV, binDir, binName);
	if (existsSync(vendored)) return vendored;

	// 2. Check system PATH
	const system = Bun.which("zubanls");
	if (system) return system;

	// 3. Auto-install into vendored venv
	return installZuban();
}

/** Creates a venv and pip-installs zuban. Returns zubanls path or undefined on failure. */
function installZuban(): string | undefined {
	const isWindows = process.platform === "win32";
	const binDir = isWindows ? "Scripts" : "bin";
	const binName = isWindows ? "zubanls.exe" : "zubanls";

	const python = Bun.which("python3") ?? Bun.which("python");
	if (!python) {
		console.error("Python not found. Install Python 3 to enable Python support.");
		return undefined;
	}

	console.log("Installing Python language server (zuban)...");

	const venvResult = Bun.spawnSync([python, "-m", "venv", VENDOR_VENV], {
		stdout: "ignore",
		stderr: "pipe",
	});
	if (venvResult.exitCode !== 0) {
		console.error(`Failed to create venv: ${venvResult.stderr.toString()}`);
		return undefined;
	}

	const pip = join(VENDOR_VENV, binDir, isWindows ? "pip.exe" : "pip");
	const pipResult = Bun.spawnSync([pip, "install", "zuban", "--quiet"], {
		stdout: "ignore",
		stderr: "pipe",
	});
	if (pipResult.exitCode !== 0) {
		console.error(`Failed to install zuban: ${pipResult.stderr.toString()}`);
		return undefined;
	}

	const zubanls = join(VENDOR_VENV, binDir, binName);
	if (!existsSync(zubanls)) {
		console.error("zubanls not found after installation");
		return undefined;
	}

	console.log("done");
	return zubanls;
}

/**
 * Builds the knowledge graph by querying LSP servers for symbols and call hierarchy,
 * scanning for @lattice: tags, and writing everything to SQLite.
 * Spawns one LSP server per language. Uses both outgoingCalls and references
 * strategies to maximize edge coverage.
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

		const lsp = resolveLspServer(langConfig.language);
		if (!lsp) continue;

		const client = await createLspClient({
			command: lsp.command,
			args: [...lsp.args],
			rootUri: `file://${projectRoot}`,
			languageId: lsp.languageId,
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

			// Phase 2a: outgoingCalls — "what does each function call?"
			for (const fd of fileDataList) {
				for (const nwp of fd.nodesWithPos) {
					if (nwp.node.kind !== "function" && nwp.node.kind !== "method") continue;

					try {
						const items = await client.prepareCallHierarchy(
							fd.filePath,
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
					} catch {
						// outgoingCalls not supported by this server — skip silently
					}
				}
			}

			// Phase 2b: references — "who references each function?"
			const nodesByFile = new Map<string, readonly Node[]>();
			for (const fd of fileDataList) {
				nodesByFile.set(
					fd.relativePath,
					fd.nodesWithPos
						.filter((nwp) => nwp.node.kind === "function" || nwp.node.kind === "method")
						.map((nwp) => nwp.node),
				);
			}

			for (const fd of fileDataList) {
				for (const nwp of fd.nodesWithPos) {
					if (nwp.node.kind !== "function" && nwp.node.kind !== "method") continue;

					try {
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

							const fileFunctions = nodesByFile.get(refFile);
							if (!fileFunctions) continue;

							const refLine = ref.range.start.line + 1;
							const caller = fileFunctions.find(
								(n) => refLine >= n.lineStart && refLine <= n.lineEnd,
							);
							if (!caller || caller.id === nwp.node.id) continue;

							allEdges.push({ sourceId: caller.id, targetId: nwp.node.id, kind: "calls" });
						}
					} catch {
						// references not supported by this server — skip silently
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
): LanguageConfig {
	const extensions = language === "python" ? [".py"] : [".ts", ".tsx"];
	return { language, extensions, sourceRoots, testPaths };
}

export {
	type BuildGraphOptions,
	type BuildStats,
	buildGraph,
	buildLanguageConfig,
	type LanguageConfig,
};
