import type { Database } from "bun:sqlite";
import type { LatticeConfig } from "../types/config.ts";
import type { LintIssue, LintResult } from "../types/lint.ts";

/**
 * Runs all lint checks against the built knowledge graph.
 * Does not modify the database — reports only.
 *
 * @param db - An open Database handle (readonly)
 * @param config - Lattice configuration for boundary package detection
 * @returns Lint result with issues, coverage, and unresolved count
 */
// @lattice:flow lint
function executeLint(db: Database, _config: LatticeConfig): LintResult {
	const issues: LintIssue[] = [];

	checkMissingFlowTags(db, issues);
	checkInvalidTags(db, issues);
	checkTypos(db, issues);
	checkOrphanedEvents(db, issues);
	checkStaleBoundaryTags(db, issues);

	const coverage = computeCoverage(db);
	const unresolvedCount = countUnresolved(db);

	return { issues, coverage, unresolvedCount };
}

/** Checks for route handlers without @lattice:flow tags. */
function checkMissingFlowTags(db: Database, issues: LintIssue[]): void {
	// Nodes with route metadata (detected by framework extractors) but no flow tag
	const rows = db
		.query(
			`SELECT n.id, n.name, n.file, n.line_start FROM nodes n
			WHERE n.metadata IS NOT NULL AND n.metadata LIKE '%"route"%'
			AND NOT EXISTS (SELECT 1 FROM tags t WHERE t.node_id = n.id AND t.kind = 'flow')`,
		)
		.all() as { id: string; name: string; file: string; line_start: number }[];

	for (const row of rows) {
		issues.push({
			severity: "error",
			file: row.file,
			line: row.line_start,
			symbol: row.name,
			message: `Route handler missing @lattice:flow tag`,
		});
	}
}

/** Checks for tags placed on invalid node kinds (e.g., flow tag on a class). */
function checkInvalidTags(db: Database, issues: LintIssue[]): void {
	const rows = db
		.query(
			`SELECT t.kind AS tag_kind, t.value, n.id, n.name, n.kind AS node_kind, n.file, n.line_start
			FROM tags t JOIN nodes n ON t.node_id = n.id
			WHERE n.kind NOT IN ('function', 'method')`,
		)
		.all() as {
		tag_kind: string;
		value: string;
		id: string;
		name: string;
		node_kind: string;
		file: string;
		line_start: number;
	}[];

	for (const row of rows) {
		issues.push({
			severity: "error",
			file: row.file,
			line: row.line_start,
			symbol: row.name,
			message: `@lattice:${row.tag_kind} tag on a ${row.node_kind} — tags should only be on functions or methods`,
		});
	}
}

/** Checks for probable typos by finding tag values used only once when similar values exist. */
function checkTypos(db: Database, issues: LintIssue[]): void {
	// Group tag values by kind, find singletons
	const tagCounts = db
		.query("SELECT kind, value, COUNT(*) as cnt FROM tags GROUP BY kind, value")
		.all() as { kind: string; value: string; cnt: number }[];

	const singletons = tagCounts.filter((t) => t.cnt === 1);
	const commons = tagCounts.filter((t) => t.cnt > 1);

	for (const single of singletons) {
		const similar = commons.filter(
			(c) => c.kind === single.kind && editDistance(single.value, c.value) <= 2,
		);
		if (similar.length > 0) {
			const bestMatch = similar[0];
			const tagNode = db
				.query(
					`SELECT n.name, n.file, n.line_start FROM tags t JOIN nodes n ON t.node_id = n.id
					WHERE t.kind = ? AND t.value = ?`,
				)
				.get(single.kind, single.value) as {
				name: string;
				file: string;
				line_start: number;
			} | null;

			if (tagNode && bestMatch) {
				issues.push({
					severity: "warning",
					file: tagNode.file,
					line: tagNode.line_start,
					symbol: tagNode.name,
					message: `@lattice:${single.kind} "${single.value}" — did you mean "${bestMatch.value}"? (used ${bestMatch.cnt} times elsewhere)`,
				});
			}
		}
	}
}

/** Checks for events that are emitted but never handled, or handled but never emitted. */
function checkOrphanedEvents(db: Database, issues: LintIssue[]): void {
	// Emits with no matching handles
	const orphanedEmits = db
		.query(
			`SELECT t.value, n.name, n.file, n.line_start FROM tags t
			JOIN nodes n ON t.node_id = n.id
			WHERE t.kind = 'emits'
			AND NOT EXISTS (SELECT 1 FROM tags h WHERE h.kind = 'handles' AND h.value = t.value)`,
		)
		.all() as { value: string; name: string; file: string; line_start: number }[];

	for (const row of orphanedEmits) {
		issues.push({
			severity: "warning",
			file: row.file,
			line: row.line_start,
			symbol: row.name,
			message: `@lattice:emits "${row.value}" has no handler — no @lattice:handles "${row.value}" found`,
		});
	}

	// Handles with no matching emits
	const orphanedHandles = db
		.query(
			`SELECT t.value, n.name, n.file, n.line_start FROM tags t
			JOIN nodes n ON t.node_id = n.id
			WHERE t.kind = 'handles'
			AND NOT EXISTS (SELECT 1 FROM tags e WHERE e.kind = 'emits' AND e.value = t.value)`,
		)
		.all() as { value: string; name: string; file: string; line_start: number }[];

	for (const row of orphanedHandles) {
		issues.push({
			severity: "warning",
			file: row.file,
			line: row.line_start,
			symbol: row.name,
			message: `@lattice:handles "${row.value}" has no emitter — no @lattice:emits "${row.value}" found`,
		});
	}
}

/**
 * Checks for stale boundary tags.
 * A boundary tag is stale if the tagged function has no uncertain call edges at all
 * (meaning it doesn't call any external code that could be the boundary).
 */
function checkStaleBoundaryTags(db: Database, issues: LintIssue[]): void {
	const boundaryTags = db
		.query(
			`SELECT t.node_id, t.value, n.name, n.file, n.line_start FROM tags t
			JOIN nodes n ON t.node_id = n.id
			WHERE t.kind = 'boundary'`,
		)
		.all() as { node_id: string; value: string; name: string; file: string; line_start: number }[];

	for (const tag of boundaryTags) {
		// A boundary function should have at least one uncertain call edge
		// (calls to external packages are marked uncertain during extraction)
		const hasExternalCall = db
			.query("SELECT 1 FROM edges WHERE source_id = ? AND certainty = 'uncertain' LIMIT 1")
			.get(tag.node_id);

		if (!hasExternalCall) {
			issues.push({
				severity: "warning",
				file: tag.file,
				line: tag.line_start,
				symbol: tag.name,
				message: `@lattice:boundary "${tag.value}" may be stale — no external calls found in this function`,
			});
		}
	}
}

/** Computes tag coverage: how many detected entry points are tagged vs total. */
function computeCoverage(db: Database): { tagged: number; total: number } {
	const total = db
		.query(
			"SELECT COUNT(*) as c FROM nodes WHERE metadata IS NOT NULL AND metadata LIKE '%\"route\"%'",
		)
		.get() as { c: number };

	const tagged = db
		.query(
			`SELECT COUNT(*) as c FROM nodes n
			WHERE n.metadata IS NOT NULL AND n.metadata LIKE '%"route"%'
			AND EXISTS (SELECT 1 FROM tags t WHERE t.node_id = n.id AND t.kind = 'flow')`,
		)
		.get() as { c: number };

	return { tagged: tagged.c, total: total.c };
}

/** Counts unresolved references in the database. */
function countUnresolved(db: Database): number {
	const row = db.query("SELECT COUNT(*) as c FROM unresolved").get() as { c: number };
	return row.c;
}

/**
 * Computes the Levenshtein edit distance between two strings.
 * Used for typo detection in tag values.
 */
function editDistance(a: string, b: string): number {
	const m = a.length;
	const n = b.length;

	// Use two rows instead of a full matrix to avoid index safety issues
	let prev = Array.from({ length: n + 1 }, (_, j) => j);
	let curr = new Array<number>(n + 1).fill(0);

	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
		}
		[prev, curr] = [curr, prev];
	}

	return prev[n] ?? 0;
}

export { executeLint };
