import { parse as parseToml } from "smol-toml";
import type { LatticeConfig, LintConfig, PythonConfig, TypeScriptConfig } from "./types/config.ts";
import { err, ok, type Result } from "./types/result.ts";

const DEFAULT_EXCLUDE = ["node_modules", "venv", ".git", "dist", "__pycache__", ".lattice"];

/**
 * Parses a TOML string into a validated LatticeConfig.
 * Returns an error for invalid TOML, missing required fields, or validation failures.
 *
 * @param tomlString - Raw contents of a lattice.toml file
 * @returns Parsed and validated config, or an error message
 */
function parseConfig(tomlString: string): Result<LatticeConfig, string> {
	let raw: Record<string, unknown>;
	try {
		raw = parseToml(tomlString) as Record<string, unknown>;
	} catch {
		return err("Invalid TOML syntax");
	}

	const project = raw.project;
	if (!isRecord(project)) {
		return err("Missing [project] section");
	}

	const languages = project.languages;
	if (!isStringArray(languages) || languages.length === 0) {
		return err("project.languages must be a non-empty array of strings");
	}

	const root = typeof project.root === "string" ? project.root : ".";
	const exclude = isStringArray(project.exclude) ? project.exclude : DEFAULT_EXCLUDE;

	const pythonConfig = languages.includes("python") ? parsePythonSection(raw.python) : undefined;

	const typescriptConfig = languages.includes("typescript")
		? parseTypeScriptSection(raw.typescript)
		: undefined;

	const lintConfig = parseLintSection(raw.lint);

	return ok({
		languages,
		root,
		exclude,
		python: pythonConfig,
		typescript: typescriptConfig,
		lint: lintConfig,
	});
}

/** Parses the [python] section with defaults for missing fields. */
function parsePythonSection(raw: unknown): PythonConfig {
	const section = isRecord(raw) ? raw : {};
	return {
		sourceRoots: isStringArray(section.source_roots) ? section.source_roots : ["."],
		testPaths: isStringArray(section.test_paths) ? section.test_paths : ["tests"],
	};
}

/** Parses the [typescript] section with defaults for missing fields. */
function parseTypeScriptSection(raw: unknown): TypeScriptConfig {
	const section = isRecord(raw) ? raw : {};
	return {
		sourceRoots: isStringArray(section.source_roots) ? section.source_roots : ["."],
		testPaths: isStringArray(section.test_paths) ? section.test_paths : ["__tests__"],
		tsconfig: typeof section.tsconfig === "string" ? section.tsconfig : undefined,
		lspCommand: typeof section.lsp_command === "string" ? section.lsp_command : undefined,
	};
}

/** Parses the [lint] section with defaults for missing fields. */
function parseLintSection(raw: unknown): LintConfig {
	const section = isRecord(raw) ? raw : {};
	return {
		strict: section.strict === true,
		ignore: isStringArray(section.ignore) ? section.ignore : [],
	};
}

/** Type guard for plain objects. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Type guard for string arrays. */
function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export { parseConfig };
