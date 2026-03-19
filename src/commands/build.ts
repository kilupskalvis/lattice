import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Extractor } from "../extract/extractor.ts";
import { initTreeSitter } from "../extract/parser.ts";
import { createPythonExtractor } from "../extract/python/extractor.ts";
import { createDatabase } from "../graph/database.ts";
import {
	insertEdges,
	insertNodes,
	insertTags,
	insertUnresolved,
	synthesizeEventEdges,
} from "../graph/writer.ts";
import type { LatticeConfig } from "../types/config.ts";
import type { ExtractionResult } from "../types/graph.ts";
import { err, ok, type Result } from "../types/result.ts";

/** Statistics from a completed build. */
type BuildStats = {
	readonly fileCount: number;
	readonly nodeCount: number;
	readonly edgeCount: number;
	readonly tagCount: number;
	readonly eventEdgeCount: number;
	readonly durationMs: number;
};

/**
 * Executes a full build of the knowledge graph.
 * Walks the source tree, runs extractors on all matching files,
 * inserts results into SQLite, and synthesizes event edges.
 *
 * @param projectRoot - Absolute or relative path to the project root
 * @param config - Parsed Lattice configuration
 * @returns Build statistics or an error message
 */
async function executeBuild(
	projectRoot: string,
	config: LatticeConfig,
): Promise<Result<BuildStats, string>> {
	const startTime = Date.now();

	try {
		// Initialize tree-sitter and create extractors
		await initTreeSitter();
		const extractors = await createExtractors(config);
		if (extractors.length === 0) {
			return err("No extractors available for configured languages");
		}

		// Build extension → extractor mapping
		const extByExt = new Map<string, Extractor>();
		for (const ext of extractors) {
			for (const fileExt of ext.fileExtensions) {
				extByExt.set(fileExt, ext);
			}
		}

		// Create .lattice directory and database
		const latticeDir = join(projectRoot, ".lattice");
		mkdirSync(latticeDir, { recursive: true });
		const dbPath = join(latticeDir, "graph.db");
		const db = createDatabase(dbPath);

		// Walk the source tree
		const sourceRoot = join(projectRoot, config.root);
		const glob = new Bun.Glob("**/*");
		const files: string[] = [];

		for await (const path of glob.scan({ cwd: sourceRoot, dot: false })) {
			const ext = `.${path.split(".").pop()}`;
			if (!extByExt.has(ext)) continue;
			if (isExcluded(path, config.exclude)) continue;
			files.push(path);
		}

		// Extract all files
		let totalNodes = 0;
		let totalEdges = 0;
		let totalTags = 0;

		for (const file of files) {
			const ext = `.${file.split(".").pop()}`;
			const extractor = extByExt.get(ext);
			if (!extractor) continue;

			const fullPath = join(sourceRoot, file);
			const source = await Bun.file(fullPath).text();
			const relativePath = relative(projectRoot, fullPath);

			const result: ExtractionResult = await extractor.extract(relativePath, source);

			insertNodes(db, result.nodes);
			insertEdges(db, result.edges);
			insertTags(db, result.tags);
			insertUnresolved(db, result.unresolved);

			totalNodes += result.nodes.length;
			totalEdges += result.edges.length;
			totalTags += result.tags.length;
		}

		// Synthesize event edges
		synthesizeEventEdges(db);
		const eventEdgeRow = db.query("SELECT COUNT(*) as c FROM edges WHERE kind = 'event'").get() as {
			c: number;
		};

		// Write build metadata
		const now = new Date().toISOString();
		db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_build', ?)", [now]);
		db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('lattice_version', '0.1.0')");

		db.close();

		return ok({
			fileCount: files.length,
			nodeCount: totalNodes,
			edgeCount: totalEdges + eventEdgeRow.c,
			tagCount: totalTags,
			eventEdgeCount: eventEdgeRow.c,
			durationMs: Date.now() - startTime,
		});
	} catch (error) {
		return err(`Build failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Creates extractors for all configured languages. */
async function createExtractors(config: LatticeConfig): Promise<readonly Extractor[]> {
	const extractors: Extractor[] = [];
	for (const lang of config.languages) {
		if (lang === "python") {
			extractors.push(await createPythonExtractor());
		}
		// TypeScript extractor will be added later
	}
	return extractors;
}

/** Checks if a file path matches any exclude pattern. */
function isExcluded(filePath: string, excludePatterns: readonly string[]): boolean {
	for (const pattern of excludePatterns) {
		if (filePath.includes(pattern.replace("**", "").replace("*", ""))) {
			return true;
		}
	}
	return false;
}

export { type BuildStats, executeBuild };
