import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "../types/result.ts";

/**
 * Initializes a Lattice project by creating .lattice/ directory
 * and a starter lattice.toml with detected languages.
 *
 * @param projectRoot - Path to the project root directory
 * @returns Ok on success, Err with a message on failure
 */
// @lattice:flow init
function executeInit(projectRoot: string): Result<string, string> {
	try {
		// Create .lattice directory
		const latticeDir = join(projectRoot, ".lattice");
		mkdirSync(latticeDir, { recursive: true });

		// Detect languages
		const languages = detectLanguages(projectRoot);

		// Generate lattice.toml if it doesn't exist
		const tomlPath = join(projectRoot, "lattice.toml");
		if (!existsSync(tomlPath)) {
			const root = detectRoot(projectRoot);
			const toml = generateToml(languages, root);
			writeFileSync(tomlPath, toml);
		}

		// Check LSP server availability
		const warnings = checkLspAvailability(languages);
		const message = ["Initialized Lattice project", ...warnings].join("\n");

		return ok(message);
	} catch (error) {
		return err(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Detects which languages are present in the project by scanning for file extensions. */
function detectLanguages(projectRoot: string): readonly string[] {
	const languages: string[] = [];
	const glob = new Bun.Glob("**/*.{py,ts,tsx,js,jsx}");

	let hasPython = false;
	let hasTypeScript = false;

	for (const path of glob.scanSync({ cwd: projectRoot, dot: false })) {
		if (
			path.includes("node_modules") ||
			path.includes(".git") ||
			path.includes("test") ||
			path.includes("fixture") ||
			path.includes("vendor") ||
			path.includes("dist")
		)
			continue;
		if (path.endsWith(".py")) hasPython = true;
		if (path.endsWith(".ts") || path.endsWith(".tsx")) hasTypeScript = true;
		if (hasPython && hasTypeScript) break;
	}

	if (hasPython) languages.push("python");
	if (hasTypeScript) languages.push("typescript");

	return languages;
}

/** Detects the source root — uses "src" if it exists, otherwise ".". */
function detectRoot(projectRoot: string): string {
	const srcPath = `${projectRoot}/src`;
	try {
		const { statSync } = require("node:fs");
		if (statSync(srcPath).isDirectory()) return "src";
	} catch {
		// src/ doesn't exist
	}
	return ".";
}

/** Generates a starter lattice.toml with detected languages. */
function generateToml(languages: readonly string[], root: string): string {
	const langArray = languages.map((l) => `"${l}"`).join(", ");
	const lines: string[] = [
		"[project]",
		`languages = [${langArray}]`,
		`root = "${root}"`,
		'exclude = ["node_modules", "venv", ".git", "dist", "__pycache__", ".lattice"]',
		"",
	];

	if (languages.includes("python")) {
		lines.push("[python]", `source_roots = ["${root}"]`, 'test_paths = ["tests"]', "");
	}

	if (languages.includes("typescript")) {
		lines.push("[typescript]", `source_roots = ["${root}"]`, 'test_paths = ["tests"]', "");
	}

	lines.push("[lint]", "strict = false", "ignore = []", "");

	return lines.join("\n");
}

/** Checks prerequisites for language support. */
function checkLspAvailability(languages: readonly string[]): readonly string[] {
	const warnings: string[] = [];
	if (languages.includes("python") && !Bun.which("python3") && !Bun.which("python")) {
		warnings.push("Warning: Python 3 not found. Install Python 3 to enable Python support.");
	}
	return warnings;
}

export { executeInit };
