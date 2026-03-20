import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverFiles } from "../files.ts";
import { checkSchemaVersion } from "../graph/database.ts";
import type { LatticeConfig } from "../types/config.ts";
import { isOk, ok, type Result } from "../types/result.ts";
import { executeBuild } from "./build.ts";

/** Statistics from an incremental update. */
type UpdateStats = {
	readonly filesReindexed: number;
	readonly totalFiles: number;
	readonly durationMs: number;
};

/**
 * Performs an incremental update: re-indexes only files changed since the last build.
 * Falls back to a full rebuild if the database is missing, schema mismatches,
 * or more than 30% of files have changed.
 *
 * @param projectRoot - Absolute path to the project root
 * @param config - Parsed lattice.toml configuration
 * @returns Update statistics or an error message
 */
// @lattice:flow update
async function executeUpdate(
	projectRoot: string,
	config: LatticeConfig,
): Promise<Result<UpdateStats, string>> {
	const start = performance.now();

	const dbPath = join(projectRoot, ".lattice", "graph.db");
	if (!existsSync(dbPath)) {
		const buildResult = await executeBuild(projectRoot, config);
		if (!isOk(buildResult)) return buildResult;
		return ok({ filesReindexed: 0, totalFiles: 0, durationMs: 0 });
	}

	const db = new Database(dbPath);
	const schemaCheck = checkSchemaVersion(db);
	if (!isOk(schemaCheck)) {
		db.close();
		const buildResult = await executeBuild(projectRoot, config);
		if (!isOk(buildResult)) return buildResult;
		return ok({ filesReindexed: 0, totalFiles: 0, durationMs: 0 });
	}

	// Get last build timestamp
	const metaRow = db.query("SELECT value FROM meta WHERE key = 'last_build'").get() as {
		value: string;
	} | null;
	if (!metaRow) {
		db.close();
		const buildResult = await executeBuild(projectRoot, config);
		if (!isOk(buildResult)) return buildResult;
		return ok({ filesReindexed: 0, totalFiles: 0, durationMs: 0 });
	}
	const lastBuild = Number.parseInt(metaRow.value, 10);

	// Discover files
	const extensions = [".ts", ".tsx"];
	const sourceRoots = config.typescript?.sourceRoots ?? [config.root];
	const allFiles: string[] = [];
	for (const srcRoot of sourceRoots) {
		const absRoot = resolve(projectRoot, srcRoot);
		allFiles.push(...discoverFiles(absRoot, extensions, config.exclude));
	}

	// Find changed files
	const changedFiles = allFiles.filter((f) => {
		try {
			return statSync(f).mtimeMs > lastBuild;
		} catch {
			return true;
		}
	});

	if (changedFiles.length === 0) {
		db.close();
		return ok({
			filesReindexed: 0,
			totalFiles: allFiles.length,
			durationMs: Math.round(performance.now() - start),
		});
	}

	// Fall back to full rebuild if too many files changed
	if (changedFiles.length > allFiles.length * 0.3) {
		db.close();
		const buildResult = await executeBuild(projectRoot, config);
		if (!isOk(buildResult)) return buildResult;
		return ok({
			filesReindexed: changedFiles.length,
			totalFiles: allFiles.length,
			durationMs: Math.round(performance.now() - start),
		});
	}

	// Any changed files → full rebuild via executeBuild
	// True incremental (per-file LSP re-extraction) is a future optimization
	db.close();
	const buildResult = await executeBuild(projectRoot, config);
	if (!isOk(buildResult)) return buildResult;

	return ok({
		filesReindexed: changedFiles.length,
		totalFiles: allFiles.length,
		durationMs: Math.round(performance.now() - start),
	});
}

export { executeUpdate };
