import type { Database } from "bun:sqlite";
import type { LatticeConfig } from "../types/config.ts";

/**
 * Generates a structured prompt that instructs a coding agent to tag the codebase.
 * Provides the tag spec, the project's structural overview from the graph,
 * and lets the agent decide what needs tagging based on understanding.
 *
 * @param db - An open Database handle with a built graph
 * @param _config - Lattice configuration (reserved for future use)
 * @returns A complete instruction string for the coding agent
 */
function executePopulate(db: Database, _config: LatticeConfig): string {
	const sections: string[] = [];

	sections.push(tagSpecSection());
	sections.push(projectStructureSection(db));
	sections.push(guidelinesSection());
	sections.push(validationSection());

	return sections.join("\n\n");
}

/** Outputs the full tag specification so the agent knows exactly what syntax to use. */
function tagSpecSection(): string {
	return `## Lattice Tag Specification

Place tags in comments directly above function definitions. No blank lines between the tag and the function definition.

### Tags

\`@lattice:flow <name>\` — Marks a business flow entry point.
Place on: route handlers, CLI command handlers, cron jobs, queue consumers, event listeners.
The flow name should describe the business operation (e.g., "checkout", "user-registration").
All functions reachable from the entry point through the call graph are automatically members of the flow.

\`@lattice:boundary <system>\` — Marks where code exits the codebase.
Place on: functions that call external APIs, databases, file systems, third-party services.
The system name should identify the external dependency (e.g., "stripe", "postgres", "redis").

\`@lattice:emits <event>\` — Marks event/message emission.
Place on: functions that publish to message queues, event buses, or notification systems.
Use the exact event name as it appears in the publish call (e.g., "order.created").

\`@lattice:handles <event>\` — Marks event/message consumption.
Place on: functions that subscribe to or consume events/messages.
Must match a corresponding emits tag for the graph to connect them.

### Syntax Rules

- Names are kebab-case: lowercase letters, numbers, hyphens, and dots
- Multiple values per tag: \`# @lattice:flow checkout, payment\`
- Works with any comment style: \`#\`, \`//\`, \`/* */\`, \`--\`

### What NOT to Tag

- Intermediate functions in a flow — derived automatically from the call graph
- Callers and callees — derived from the AST
- Types, interfaces, data models — derived from the AST
- Internal utilities — they appear in the graph through call edges

### Examples

Python:
\`\`\`python
# @lattice:flow checkout
@app.post("/api/checkout")
def handle_checkout(req):
    order = create_order(req)
    return order
\`\`\`

TypeScript:
\`\`\`typescript
// @lattice:boundary stripe
export async function charge(amount: number): Promise<Result> {
  return stripe.charges.create({ amount });
}
\`\`\``;
}

/** Outputs the project's structural overview so the agent understands the codebase layout. */
function projectStructureSection(db: Database): string {
	const lines: string[] = ["## Project Structure", ""];

	// File summary
	const files = db.query("SELECT DISTINCT file FROM nodes ORDER BY file").all() as {
		file: string;
	}[];
	lines.push(`### Files (${files.length})`);
	lines.push("");
	for (const f of files) {
		const nodeCount = (
			db.query("SELECT COUNT(*) as c FROM nodes WHERE file = ?").get(f.file) as { c: number }
		).c;
		lines.push(`- \`${f.file}\` (${nodeCount} symbols)`);
	}

	// Top-level functions with most connections (hubs)
	const hubs = db
		.query(
			`SELECT n.id, n.name, n.file, n.line_start,
				(SELECT COUNT(*) FROM edges WHERE source_id = n.id AND kind = 'calls') as outgoing,
				(SELECT COUNT(*) FROM edges WHERE target_id = n.id AND kind = 'calls') as incoming
			FROM nodes n
			WHERE n.kind IN ('function', 'method')
			ORDER BY (outgoing + incoming) DESC
			LIMIT 15`,
		)
		.all() as {
		id: string;
		name: string;
		file: string;
		line_start: number;
		outgoing: number;
		incoming: number;
	}[];

	if (hubs.length > 0) {
		lines.push("");
		lines.push("### Key Functions (most connected)");
		lines.push("");
		for (const hub of hubs) {
			lines.push(
				`- \`${hub.name}\` (${hub.file}:${hub.line_start}) — ${hub.incoming} callers, ${hub.outgoing} callees`,
			);
		}
	}

	// Existing tags (if any)
	const existingTags = db
		.query("SELECT kind, value, node_id FROM tags ORDER BY kind, value")
		.all() as {
		kind: string;
		value: string;
		node_id: string;
	}[];
	if (existingTags.length > 0) {
		lines.push("");
		lines.push("### Existing Tags");
		lines.push("");
		for (const tag of existingTags) {
			lines.push(`- \`@lattice:${tag.kind} ${tag.value}\` on \`${tag.node_id}\``);
		}
	}

	return lines.join("\n");
}

/** Provides guidelines for the agent on how to approach tagging. */
function guidelinesSection(): string {
	return `## Guidelines

1. **Start with entry points.** Identify the main ways code gets executed — HTTP handlers, CLI commands, cron jobs, queue consumers — and tag them with \`@lattice:flow\`.

2. **Tag external boundaries.** Find functions that call external systems (APIs, databases, caches, message queues) and tag them with \`@lattice:boundary\`.

3. **Tag event connections.** If the codebase uses event-driven patterns (publish/subscribe, message queues), tag the publishers with \`@lattice:emits\` and consumers with \`@lattice:handles\`.

4. **Use domain names.** Flow names should reflect business concepts ("checkout", "user-registration"), not function names ("handle-post-request").

5. **Don't over-tag.** Only tag entry points and boundaries. Everything in between is derived from the call graph. If a function is called by a tagged entry point, it's automatically part of that flow.

6. **Read the function before tagging.** Understand what it does and what role it plays before deciding on a tag and name.`;
}

/** Outputs validation instructions for after tagging. */
function validationSection(): string {
	return `## After Tagging

Rebuild the graph and validate:

\`\`\`bash
lattice build && lattice lint
\`\`\`

Fix any lint errors reported, then rebuild and lint again until clean.

Use \`lattice overview\` to verify the tagged flows, boundaries, and events look correct.
Use \`lattice flow <name>\` to verify each flow's call tree makes sense.`;
}

export { executePopulate };
