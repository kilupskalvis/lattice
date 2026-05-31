import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

		// Append Lattice section to CLAUDE.md (skip if already present)
		const claudeDir = join(projectRoot, ".claude");
		const claudeMdPath = join(claudeDir, "CLAUDE.md");
		mkdirSync(claudeDir, { recursive: true });
		const existing = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, "utf-8") : "";
		if (!existing.includes("## Code Navigation")) {
			const snippet = generateClaudeSnippet(languages);
			const separator = existing.length > 0 && !existing.endsWith("\n\n") ? "\n\n" : "";
			appendFileSync(claudeMdPath, `${separator}${snippet}`);
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

/** Detects the source root - uses "src" if it exists, otherwise ".". */
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

const PYTHON_EXAMPLE = `\`\`\`bash
# 1. Orient: what flows exist?
lattice overview

# 2. Locate: find the relevant flow
lattice flow user-registration

# Output:
# register (app/auth/routes.py:45)
#   → validate_input (app/auth/validation.py:12)
#   → create_user (app/auth/service.py:30)
#     → hash_password (app/auth/crypto.py:8)
#     → insert_user (app/storage/postgres.py:55) [postgres]
#   → send_welcome_email (app/notifications/email.py:20) [sendgrid]

# 3. Understand: zoom into the function you suspect
lattice context create_user

# 4. Scope: check what breaks if you change it
lattice impact create_user

# 5. Read: get just that function's source
lattice code create_user

# 6. Edit: use Read/Edit tools on app/auth/service.py:30
\`\`\`

### Symbol format

Unique names work directly. Ambiguous names need file qualification.

\`\`\`bash
lattice context create_user                       # unique name
lattice context app/auth/service.py::create_user  # file::function
lattice context app/models.py::User.save          # file::Class.method
\`\`\``;

const TYPESCRIPT_EXAMPLE = `\`\`\`bash
# 1. Orient: what flows exist?
lattice overview

# 2. Locate: find the relevant flow
lattice flow checkout

# Output:
# handleCheckout (src/api/checkout.ts:25)
#   → validateCart (src/cart/validation.ts:12)
#   → createOrder (src/orders/service.ts:40)
#     → insertOrder (src/db/orders.ts:18) [postgres]
#     → chargePayment (src/payments/stripe.ts:30) [stripe]
#   → sendConfirmation (src/notifications/email.ts:55) [sendgrid]

# 3. Understand: zoom into the function you suspect
lattice context createOrder

# 4. Scope: check what breaks if you change it
lattice impact createOrder

# 5. Read: get just that function's source
lattice code createOrder

# 6. Edit: use Read/Edit tools on src/orders/service.ts:40
\`\`\`

### Symbol format

Unique names work directly. Ambiguous names need file qualification.

\`\`\`bash
lattice context createOrder                          # unique name
lattice context src/orders/service.ts::createOrder   # file::function
\`\`\``;

const GO_EXAMPLE = `\`\`\`bash
# 1. Orient: what flows exist?
lattice overview

# 2. Locate: find the relevant flow
lattice flow create-order

# Output:
# HandleCreateOrder (internal/api/orders.go:35)
#   → ValidateRequest (internal/api/validation.go:20)
#   → CreateOrder (internal/service/orders.go:45)
#     → InsertOrder (internal/repo/orders.go:28) [postgres]
#     → PublishEvent (internal/events/publisher.go:15) [nats]

# 3. Understand: zoom into the function you suspect
lattice context CreateOrder

# 4. Scope: check what breaks if you change it
lattice impact CreateOrder

# 5. Read: get just that function's source
lattice code CreateOrder

# 6. Edit: use Read/Edit tools on internal/service/orders.go:45
\`\`\`

### Symbol format

Unique names work directly. Ambiguous names need file qualification.

\`\`\`bash
lattice context CreateOrder                                # unique name
lattice context internal/service/orders.go::CreateOrder    # file::function
lattice context internal/api/server.go::Server.Handle      # file::Struct.Method
\`\`\``;

/** Generates a CLAUDE.md snippet with language-appropriate few-shot examples. */
function generateClaudeSnippet(languages: readonly string[]): string {
	const primary = languages[0] ?? "typescript";
	const example =
		primary === "python" ? PYTHON_EXAMPLE : primary === "go" ? GO_EXAMPLE : TYPESCRIPT_EXAMPLE;

	return `## Code Navigation

This project uses **Lattice** for codebase navigation. Use Lattice before reading files or Grep.

### Example: full workflow

${example}

### After code changes

\`\`\`bash
lattice update
\`\`\`
`;
}

export { executeInit, generateClaudeSnippet };
