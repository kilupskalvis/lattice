import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Extractor } from "../extract/extractor.ts";
import { initTreeSitter } from "../extract/parser.ts";
import { createPythonExtractor } from "../extract/python/extractor.ts";
import { checkSchemaVersion } from "../graph/database.ts";
import {
	deleteFileData,
	insertEdges,
	insertNodes,
	insertTags,
	insertUnresolved,
	synthesizeEventEdges,
} from "../graph/writer.ts";
import type { LatticeConfig } from "../types/config.ts";
import type { ExtractionResult } from "../types/graph.ts";
import { err, isOk, ok, type Result } from "../types/result.ts";

/** Statistics from an incremental update. */
type UpdateStats = {
	readonly totalFiles: number;
	readonly filesReindexed: number;
	readonly durationMs: number;
};

/**
 * Performs an incremental update of the knowledge graph.
 * Only re-indexes files that have changed since the last build.
 * Falls back to a full rebuild if >30% of files are dirty.
 *
 * @param projectRoot - Path to the project root
 * @param config - Lattice configuration
 * @returns Update statistics or an error message
 */
async function executeUpdate(
	projectRoot: string,
	config: LatticeConfig,
): Promise<Result<UpdateStats, string>> {
	const startTime = Date.now();
	const dbPath = join(projectRoot, ".lattice", "graph.db");

	if (!existsSync(dbPath)) {
		return err("No existing graph found. Run 'lattice build' first.");
	}

	try {
		const db = new Database(dbPath);
		const schemaCheck = checkSchemaVersion(db);
		if (!isOk(schemaCheck)) {
			db.close();
			return err(schemaCheck.error);
		}

		// Get last build time
		const lastBuildRow = db.query("SELECT value FROM meta WHERE key = 'last_build'").get() as {
			value: string;
		} | null;
		if (!lastBuildRow) {
			db.close();
			return err("No last_build timestamp found. Run 'lattice build' first.");
		}
		const lastBuild = new Date(lastBuildRow.value);

		// Initialize extractors
		await initTreeSitter();
		const extractors = await createExtractors(config);
		const extByExt = new Map<string, Extractor>();
		for (const ext of extractors) {
			for (const fileExt of ext.fileExtensions) {
				extByExt.set(fileExt, ext);
			}
		}

		// Scan all files, find changed ones
		const sourceRoot = join(projectRoot, config.root);
		const glob = new Bun.Glob("**/*");
		const allFiles: string[] = [];
		const changedFiles: string[] = [];

		for await (const path of glob.scan({ cwd: sourceRoot, dot: false })) {
			const ext = `.${path.split(".").pop()}`;
			if (!extByExt.has(ext)) continue;
			if (isExcluded(path, config.exclude)) continue;
			allFiles.push(path);

			const fullPath = join(sourceRoot, path);
			const stat = statSync(fullPath);
			if (stat.mtime > lastBuild) {
				changedFiles.push(path);
			}
		}

		// Fall back to full rebuild if >30% changed
		if (changedFiles.length > allFiles.length * 0.3) {
			db.close();
			const { executeBuild } = await import("./build.ts");
			return executeBuild(projectRoot, config).then((result) => {
				if (isOk(result)) {
					return ok({
						totalFiles: allFiles.length,
						filesReindexed: allFiles.length,
						durationMs: Date.now() - startTime,
					});
				}
				return err(result.error);
			});
		}

		// Re-extract changed files
		for (const file of changedFiles) {
			const ext = `.${file.split(".").pop()}`;
			const extractor = extByExt.get(ext);
			if (!extractor) continue;

			const fullPath = join(sourceRoot, file);
			const source = await Bun.file(fullPath).text();
			const relativePath = relative(projectRoot, fullPath);

			// Delete old data for this file
			deleteFileData(db, relativePath);

			// Re-extract
			const result: ExtractionResult = await extractor.extract(relativePath, source);
			insertNodes(db, result.nodes);
			insertEdges(db, result.edges);
			insertTags(db, result.tags);
			insertUnresolved(db, result.unresolved);
		}

		// Rebuild event edges
		synthesizeEventEdges(db);

		// Update timestamp
		db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_build', ?)", [
			new Date().toISOString(),
		]);

		db.close();

		return ok({
			totalFiles: allFiles.length,
			filesReindexed: changedFiles.length,
			durationMs: Date.now() - startTime,
		});
	} catch (error) {
		return err(`Update failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Creates extractors for configured languages. */
async function createExtractors(config: LatticeConfig): Promise<readonly Extractor[]> {
	const extractors: Extractor[] = [];
	for (const lang of config.languages) {
		if (lang === "python") {
			extractors.push(await createPythonExtractor());
		}
	}
	return extractors;
}

/** Checks if a file path matches any exclude pattern. */
function isExcluded(filePath: string, excludePatterns: readonly string[]): boolean {
	for (const pattern of excludePatterns) {
		if (filePath.includes(pattern.replace("**", "").replace("*", ""))) return true;
	}
	return false;
}

export { executeUpdate, type UpdateStats };
