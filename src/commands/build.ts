import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createDatabase } from "../graph/database.ts";
import {
	type BuildStats,
	buildGraph,
	buildLanguageConfig,
	type LanguageConfig,
} from "../lsp/builder.ts";
import type { LatticeConfig } from "../types/config.ts";
import { err, ok, type Result } from "../types/result.ts";

/**
 * Performs a full graph build using LSP extraction.
 * Clears existing data, spawns a language server per configured language,
 * extracts symbols and call hierarchy, scans for tags, and writes everything to SQLite.
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

		const languageConfigs = buildLanguageConfigs(config);

		const stats = await buildGraph({
			projectRoot,
			db,
			languageConfigs,
			exclude: config.exclude,
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

/** Builds LanguageConfig entries from LatticeConfig for each configured language. */
function buildLanguageConfigs(config: LatticeConfig): readonly LanguageConfig[] {
	const configs: LanguageConfig[] = [];

	if (config.languages.includes("typescript") && config.typescript) {
		configs.push(
			buildLanguageConfig("typescript", config.typescript.sourceRoots, config.typescript.testPaths),
		);
	} else if (config.languages.includes("typescript")) {
		configs.push(buildLanguageConfig("typescript", [config.root], []));
	}

	if (config.languages.includes("python") && config.python) {
		configs.push(buildLanguageConfig("python", config.python.sourceRoots, config.python.testPaths));
	} else if (config.languages.includes("python")) {
		configs.push(buildLanguageConfig("python", [config.root], ["tests"]));
	}

	if (config.languages.includes("go") && config.go) {
		configs.push(buildLanguageConfig("go", config.go.sourceRoots, config.go.testPaths));
	} else if (config.languages.includes("go")) {
		configs.push(buildLanguageConfig("go", [config.root], []));
	}

	return configs;
}

export { executeBuild };
