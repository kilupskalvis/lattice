/** Configuration for a Python language section. */
type PythonConfig = {
	readonly sourceRoots: readonly string[];
	readonly testPaths: readonly string[];
	readonly frameworks: readonly string[];
};

/** Configuration for a TypeScript language section. */
type TypeScriptConfig = {
	readonly sourceRoots: readonly string[];
	readonly testPaths: readonly string[];
	readonly tsconfig: string | undefined;
	readonly frameworks: readonly string[];
};

/** Lint-specific configuration. */
type LintConfig = {
	readonly strict: boolean;
	readonly ignore: readonly string[];
	readonly boundaryPackages: readonly string[];
};

/** Top-level Lattice configuration parsed from lattice.toml. */
type LatticeConfig = {
	readonly languages: readonly string[];
	readonly root: string;
	readonly exclude: readonly string[];
	readonly python: PythonConfig | undefined;
	readonly typescript: TypeScriptConfig | undefined;
	readonly lint: LintConfig;
};

export type { LatticeConfig, LintConfig, PythonConfig, TypeScriptConfig };
