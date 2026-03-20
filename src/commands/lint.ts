import type { Database } from "bun:sqlite";
import type { LatticeConfig } from "../types/config.ts";
import type { LintIssue, LintResult } from "../types/lint.ts";

/**
 * Runs all lint checks against the built knowledge graph.
 * Does not modify the database — reports only.
 *
 * @param db - An open Database handle (readonly)
 * @param config - Lattice configuration
 * @returns Lint result with issues and coverage
 */
// @lattice:flow lint
function executeLint(db: Database, _config: LatticeConfig): LintResult {
	const issues: LintIssue[] = [];

	checkInvalidTags(db, issues);
	checkTypos(db, issues);
	checkOrphanedEvents(db, issues);
	checkStaleBoundaryTags(db, issues);
	checkMissingBoundaryTags(db, issues);
	checkDeadEndFlows(db, issues);
	checkDisconnectedFunctions(db, issues);

	const coverage = computeCoverage(db);

	return { issues, coverage };
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
 * A boundary tag is stale if the function has no external calls recorded in the external_calls table.
 */
function checkStaleBoundaryTags(db: Database, issues: LintIssue[]): void {
	const boundaryTags = db
		.query(
			`SELECT t.node_id, t.value, n.name, n.file, n.line_start FROM tags t
			JOIN nodes n ON t.node_id = n.id
			WHERE t.kind = 'boundary'`,
		)
		.all() as {
		node_id: string;
		value: string;
		name: string;
		file: string;
		line_start: number;
	}[];

	for (const tag of boundaryTags) {
		const hasExternalCall = db
			.query("SELECT 1 FROM external_calls WHERE node_id = ? LIMIT 1")
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

/**
 * Checks for functions that call external packages but have no @lattice:boundary tag.
 */
function checkMissingBoundaryTags(db: Database, issues: LintIssue[]): void {
	const rows = db
		.query(
			`SELECT DISTINCT ec.node_id, ec.package, n.name, n.file, n.line_start
			FROM external_calls ec
			JOIN nodes n ON ec.node_id = n.id
			WHERE NOT EXISTS (
				SELECT 1 FROM tags t WHERE t.node_id = ec.node_id AND t.kind = 'boundary'
			)`,
		)
		.all() as {
		node_id: string;
		package: string;
		name: string;
		file: string;
		line_start: number;
	}[];

	for (const row of rows) {
		issues.push({
			severity: "warning",
			file: row.file,
			line: row.line_start,
			symbol: row.name,
			message: `Function calls external package '${row.package}' but has no @lattice:boundary tag`,
		});
	}
}

/**
 * Checks for flow entry points with zero callees — the flow tree is just the root node.
 * This typically indicates dynamic dispatch, decorated functions, or missing event connections.
 */
function checkDeadEndFlows(db: Database, issues: LintIssue[]): void {
	const flowEntries = db
		.query(
			`SELECT t.value AS flow_name, n.id, n.name, n.file, n.line_start
			FROM tags t JOIN nodes n ON t.node_id = n.id
			WHERE t.kind = 'flow'`,
		)
		.all() as {
		flow_name: string;
		id: string;
		name: string;
		file: string;
		line_start: number;
	}[];

	for (const entry of flowEntries) {
		const hasCallees = db
			.query("SELECT 1 FROM edges WHERE source_id = ? AND kind IN ('calls', 'event') LIMIT 1")
			.get(entry.id);

		if (!hasCallees) {
			issues.push({
				severity: "warning",
				file: entry.file,
				line: entry.line_start,
				symbol: entry.name,
				message: `Flow "${entry.flow_name}" entry point has no callees — the call tree may be incomplete. If this function dispatches through a queue or dynamic dispatch, add @lattice:emits/@lattice:handles tags.`,
			});
		}
	}
}

/**
 * Checks for functions that have callees but are unreachable from any flow.
 * These are likely worker handlers or event consumers that need flow/handles tags.
 */
function checkDisconnectedFunctions(db: Database, issues: LintIssue[]): void {
	// Find functions with callees (they do work) that no flow can reach
	const disconnected = db
		.query(
			`SELECT n.id, n.name, n.file, n.line_start,
				(SELECT COUNT(*) FROM edges WHERE source_id = n.id AND kind IN ('calls', 'event')) as callee_count
			FROM nodes n
			WHERE n.kind IN ('function', 'method')
			AND n.is_test = 0
			AND NOT EXISTS (SELECT 1 FROM tags WHERE node_id = n.id)
			AND EXISTS (SELECT 1 FROM edges WHERE source_id = n.id AND kind IN ('calls', 'event'))
			AND NOT EXISTS (
				WITH RECURSIVE flow_reachable AS (
					SELECT node_id AS id FROM tags WHERE kind = 'flow'
					UNION
					SELECT e.target_id FROM edges e
					JOIN flow_reachable fr ON e.source_id = fr.id
					WHERE e.kind IN ('calls', 'event')
				)
				SELECT 1 FROM flow_reachable WHERE id = n.id
			)`,
		)
		.all() as {
		id: string;
		name: string;
		file: string;
		line_start: number;
		callee_count: number;
	}[];

	// Only report functions with 3+ callees to reduce noise
	for (const fn of disconnected) {
		if (fn.callee_count < 3) continue;
		issues.push({
			severity: "info",
			file: fn.file,
			line: fn.line_start,
			symbol: fn.name,
			message: `Function has ${fn.callee_count} callees but is unreachable from any flow. Consider adding @lattice:flow or @lattice:handles tag.`,
		});
	}
}

/** Computes tag coverage: how many tags exist vs total functions. */
function computeCoverage(db: Database): { tagged: number; total: number } {
	const total = (
		db.query("SELECT COUNT(*) as c FROM nodes WHERE kind IN ('function', 'method')").get() as {
			c: number;
		}
	).c;
	const tagged = (db.query("SELECT COUNT(DISTINCT node_id) as c FROM tags").get() as { c: number })
		.c;
	return { tagged, total };
}

/**
 * Computes the Levenshtein edit distance between two strings.
 * Used for typo detection in tag values.
 */
function editDistance(a: string, b: string): number {
	const m = a.length;
	const n = b.length;

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
