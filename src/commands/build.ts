import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createDatabase } from "../graph/database.ts";
import { type BuildStats, buildGraph } from "../lsp/builder.ts";
import type { LatticeConfig } from "../types/config.ts";
import { err, ok, type Result } from "../types/result.ts";

/**
 * Performs a full graph build using LSP extraction.
 * Clears existing data, spawns a language server, extracts symbols and call hierarchy,
 * scans for tags, and writes everything to SQLite.
 *
 * @param projectRoot - Absolute path to the project root
 * @param config - Parsed lattice.toml configuration
 * @returns Build statistics or an error message
 */
// @lattice:flow build
async function executeBuild(
	projectRoot: string,
	config: LatticeConfig,
): Promise<Result<BuildStats, string>> {
	try {
		const latticeDir = join(projectRoot, ".lattice");
		mkdirSync(latticeDir, { recursive: true });
		const dbPath = join(latticeDir, "graph.db");
		const db = createDatabase(dbPath);

		db.run("DELETE FROM external_calls");
		db.run("DELETE FROM tags");
		db.run("DELETE FROM edges");
		db.run("DELETE FROM nodes");

		const stats = await buildGraph({
			projectRoot,
			db,
			languages: config.languages,
			sourceRoots: config.typescript?.sourceRoots ?? [config.root],
			exclude: config.exclude,
			testPaths: config.typescript?.testPaths ?? [],
			lspCommand: config.typescript?.lspCommand,
		});

		db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_build', ?)", [
			String(Date.now()),
		]);

		db.close();
		return ok(stats);
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
}

export { executeBuild };
