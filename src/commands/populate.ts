import type { Database } from "bun:sqlite";
import type { LatticeConfig } from "../types/config.ts";

/**
 * Generates a structured prompt that instructs a coding agent to tag the codebase.
 * Uses the built graph to identify functions that need tags and provides context.
 *
 * @param db - An open Database handle with a built graph
 * @param config - Lattice configuration
 * @returns A complete instruction string for the coding agent
 */
function executePopulate(db: Database, config: LatticeConfig): string {
	const sections: string[] = [];

	sections.push(tagSpecSection());
	sections.push(flowCandidatesSection(db));
	sections.push(boundaryCandidatesSection(db, config));
	sections.push(eventCandidatesSection(db));
	sections.push(instructionsSection());

	return sections.join("\n\n");
}

/** Outputs the tag specification for the agent. */
function tagSpecSection(): string {
	return `## Tag Syntax

Place tags in comments directly above function definitions. No blank lines between the tag and the function.

  # @lattice:flow <name>       — on flow entry points (route handlers, CLI commands, cron jobs)
  # @lattice:boundary <system> — on functions that call external systems (APIs, databases)
  # @lattice:emits <event>     — on functions that emit events/messages
  # @lattice:handles <event>   — on functions that consume events/messages

Names must be kebab-case: lowercase letters, numbers, hyphens, dots.`;
}

/** Finds route handlers without @lattice:flow tags. */
function flowCandidatesSection(db: Database): string {
	const rows = db
		.query(
			`SELECT n.id, n.name, n.file, n.line_start, n.metadata FROM nodes n
			WHERE n.metadata IS NOT NULL AND n.metadata LIKE '%"route"%'
			AND NOT EXISTS (SELECT 1 FROM tags t WHERE t.node_id = n.id AND t.kind = 'flow')
			ORDER BY n.file, n.line_start`,
		)
		.all() as { id: string; name: string; file: string; line_start: number; metadata: string }[];

	if (rows.length === 0) {
		return "## Entry Points (add @lattice:flow)\n\nNo untagged entry points detected.";
	}

	const lines = ["## Entry Points (add @lattice:flow)", ""];
	for (const row of rows) {
		const meta = JSON.parse(row.metadata) as Record<string, string>;
		const route = meta.route ?? "";
		lines.push(`- ${row.file}:${row.line_start}  ${row.name}  — ${route}`);

		// Add context: what this function calls
		const callees = db
			.query(
				`SELECT n.name FROM edges e JOIN nodes n ON e.target_id = n.id
				WHERE e.source_id = ? AND e.kind = 'calls'`,
			)
			.all(row.id) as { name: string }[];
		if (callees.length > 0) {
			lines.push(`  Calls: ${callees.map((c) => c.name).join(", ")}`);
		}
	}

	return lines.join("\n");
}

/** Finds functions calling boundary packages without @lattice:boundary tags. */
function boundaryCandidatesSection(db: Database, config: LatticeConfig): string {
	const boundaryPackages = config.lint.boundaryPackages;
	if (boundaryPackages.length === 0) {
		return "## Boundaries (add @lattice:boundary)\n\nNo boundary packages configured.";
	}

	const candidates: { name: string; file: string; line: number; packages: string[] }[] = [];

	const untaggedNodes = db
		.query(
			`SELECT DISTINCT e.source_id FROM edges e
			WHERE e.certainty = 'uncertain'
			AND NOT EXISTS (SELECT 1 FROM tags t WHERE t.node_id = e.source_id AND t.kind = 'boundary')`,
		)
		.all() as { source_id: string }[];

	for (const edge of untaggedNodes) {
		const targets = db
			.query("SELECT target_id FROM edges WHERE source_id = ? AND certainty = 'uncertain'")
			.all(edge.source_id) as { target_id: string }[];

		const matchedPackages = boundaryPackages.filter((pkg) =>
			targets.some((t) => t.target_id.startsWith(`${pkg}.`) || t.target_id === pkg),
		);

		if (matchedPackages.length > 0) {
			const node = db
				.query("SELECT name, file, line_start FROM nodes WHERE id = ?")
				.get(edge.source_id) as {
				name: string;
				file: string;
				line_start: number;
			} | null;
			if (node) {
				candidates.push({
					name: node.name,
					file: node.file,
					line: node.line_start,
					packages: matchedPackages,
				});
			}
		}
	}

	if (candidates.length === 0) {
		return "## Boundaries (add @lattice:boundary)\n\nNo untagged boundary calls detected.";
	}

	const lines = ["## Boundaries (add @lattice:boundary)", ""];
	for (const c of candidates) {
		lines.push(`- ${c.file}:${c.line}  ${c.name}  — calls ${c.packages.join(", ")}`);
	}

	return lines.join("\n");
}

/** Placeholder for event candidate detection. */
function eventCandidatesSection(_db: Database): string {
	return "## Events (add @lattice:emits / @lattice:handles)\n\nReview functions that publish to queues or consume from event handlers.";
}

/** Outputs the post-populate instructions. */
function instructionsSection(): string {
	return `## Instructions

1. Read each function listed above
2. Add the appropriate tag in a comment directly above the function definition
3. For flow names, use the domain concept (e.g., "checkout", not "handle-checkout")
4. For boundary names, use the external system (e.g., "stripe", "postgres")
5. For events, use the exact string from the emit/consume call

## After Tagging

Run: lattice build && lattice lint
Fix any lint errors, then run again until clean.`;
}

export { executePopulate };
