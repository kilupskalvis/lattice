import type { Database } from "bun:sqlite";
import type { Node } from "../types/graph.ts";

/** Raw node row from SQLite with snake_case column names. */
type NodeRow = {
	id: string;
	kind: string;
	name: string;
	file: string;
	line_start: number;
	line_end: number;
	language: string;
	signature: string | null;
	is_test: number;
	metadata: string | null;
};

/** Converts a raw SQLite row to a typed Node. */
function rowToNode(row: NodeRow): Node {
	return {
		id: row.id,
		kind: row.kind as Node["kind"],
		name: row.name,
		file: row.file,
		lineStart: row.line_start,
		lineEnd: row.line_end,
		language: row.language,
		signature: row.signature ?? undefined,
		isTest: row.is_test === 1,
		metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, string>) : undefined,
	};
}

/** Flow entry point with its tag value and associated node. */
type FlowEntry = {
	readonly value: string;
	readonly node: Node;
};

/** Boundary tag with its value and associated node. */
type BoundaryEntry = {
	readonly value: string;
	readonly node: Node;
};

/** An event connection between an emitter and a handler. */
type EventConnection = {
	readonly eventName: string;
	readonly emitterName: string;
	readonly emitterFile: string;
	readonly handlerName: string;
	readonly handlerFile: string;
};

/**
 * Resolves a symbol by full ID or short name.
 * Full ID match takes priority. Falls back to name match.
 *
 * @param db - An open Database handle
 * @param symbol - Full node ID or short symbol name
 * @returns Matching nodes, empty if none found
 */
function resolveSymbol(db: Database, symbol: string): readonly Node[] {
	// Try exact ID match first
	const exact = db.query("SELECT * FROM nodes WHERE id = ?").get(symbol) as NodeRow | null;
	if (exact) return [rowToNode(exact)];

	// Fall back to name match
	const byName = db.query("SELECT * FROM nodes WHERE name = ?").all(symbol) as NodeRow[];
	return byName.map(rowToNode);
}

/**
 * Returns all nodes that are members of a flow via recursive call graph traversal.
 * Includes the tagged entry point(s) and all nodes reachable through calls and event edges.
 *
 * @param db - An open Database handle
 * @param flowName - The flow tag value to query
 * @returns All nodes in the flow
 */
function getFlowMembers(db: Database, flowName: string): readonly Node[] {
	const rows = db
		.query(
			`WITH RECURSIVE flow_members AS (
				SELECT node_id FROM tags WHERE kind = 'flow' AND value = ?
				UNION
				SELECT e.target_id FROM edges e
				JOIN flow_members fm ON e.source_id = fm.node_id
				WHERE e.kind IN ('calls', 'event')
			)
			SELECT n.* FROM nodes n WHERE n.id IN (SELECT node_id FROM flow_members)`,
		)
		.all(flowName) as NodeRow[];
	return rows.map(rowToNode);
}

/**
 * Returns direct callers of a node (reverse call/event edges).
 *
 * @param db - An open Database handle
 * @param nodeId - The full node ID
 * @returns Nodes that directly call or trigger this node
 */
function getCallers(db: Database, nodeId: string): readonly Node[] {
	const rows = db
		.query(
			`SELECT n.* FROM nodes n
			JOIN edges e ON n.id = e.source_id
			WHERE e.target_id = ? AND e.kind IN ('calls', 'event')`,
		)
		.all(nodeId) as NodeRow[];
	return rows.map(rowToNode);
}

/**
 * Returns direct callees of a node (forward call/event edges).
 *
 * @param db - An open Database handle
 * @param nodeId - The full node ID
 * @returns Nodes that this node directly calls or triggers
 */
function getCallees(db: Database, nodeId: string): readonly Node[] {
	const rows = db
		.query(
			`SELECT n.* FROM nodes n
			JOIN edges e ON n.id = e.target_id
			WHERE e.source_id = ? AND e.kind IN ('calls', 'event')`,
		)
		.all(nodeId) as NodeRow[];
	return rows.map(rowToNode);
}

/**
 * Returns all transitive callers of a node (upstream traversal).
 * Used for impact analysis — "what is affected if I change this?"
 *
 * @param db - An open Database handle
 * @param nodeId - The full node ID to analyze
 * @returns All nodes that transitively depend on this node
 */
function getImpact(db: Database, nodeId: string): readonly Node[] {
	const rows = db
		.query(
			`WITH RECURSIVE upstream AS (
				SELECT source_id FROM edges WHERE target_id = ? AND kind IN ('calls', 'event')
				UNION
				SELECT e.source_id FROM edges e
				JOIN upstream u ON e.target_id = u.source_id
				WHERE e.kind IN ('calls', 'event')
			)
			SELECT n.* FROM nodes n WHERE n.id IN (SELECT source_id FROM upstream)`,
		)
		.all(nodeId) as NodeRow[];
	return rows.map(rowToNode);
}

/**
 * Returns which flows a node participates in (derived from graph traversal).
 * Checks if any flow entry point can reach this node through the call graph.
 *
 * @param db - An open Database handle
 * @param nodeId - The full node ID
 * @returns Flow names this node belongs to
 */
function getFlowsForNode(db: Database, nodeId: string): readonly string[] {
	// First check if the node itself has a flow tag
	const directTags = db
		.query("SELECT value FROM tags WHERE node_id = ? AND kind = 'flow'")
		.all(nodeId) as { value: string }[];

	// Then check if any flow reaches this node
	const derivedFlows = db
		.query(
			`SELECT DISTINCT t.value FROM tags t
			WHERE t.kind = 'flow'
			AND EXISTS (
				WITH RECURSIVE flow_members AS (
					SELECT t.node_id AS node_id
					UNION
					SELECT e.target_id FROM edges e
					JOIN flow_members fm ON e.source_id = fm.node_id
					WHERE e.kind IN ('calls', 'event')
				)
				SELECT 1 FROM flow_members WHERE node_id = ?
			)`,
		)
		.all(nodeId) as { value: string }[];

	const all = new Set([...directTags.map((t) => t.value), ...derivedFlows.map((f) => f.value)]);
	return [...all];
}

/**
 * Returns all flow entry points in the graph.
 *
 * @param db - An open Database handle
 * @returns Flow entries with tag value and associated node
 */
function getAllFlows(db: Database): readonly FlowEntry[] {
	const rows = db
		.query(
			`SELECT t.value, n.* FROM tags t
			JOIN nodes n ON t.node_id = n.id
			WHERE t.kind = 'flow'
			ORDER BY t.value, n.file`,
		)
		.all() as (NodeRow & { value: string })[];
	return rows.map((row) => ({ value: row.value, node: rowToNode(row) }));
}

/**
 * Returns all boundary-tagged nodes in the graph.
 *
 * @param db - An open Database handle
 * @returns Boundary entries with tag value and associated node
 */
function getAllBoundaries(db: Database): readonly BoundaryEntry[] {
	const rows = db
		.query(
			`SELECT t.value, n.* FROM tags t
			JOIN nodes n ON t.node_id = n.id
			WHERE t.kind = 'boundary'
			ORDER BY t.value, n.file`,
		)
		.all() as (NodeRow & { value: string })[];
	return rows.map((row) => ({ value: row.value, node: rowToNode(row) }));
}

/**
 * Returns all event connections (emits → handles).
 *
 * @param db - An open Database handle
 * @returns Event connections with emitter and handler info
 */
function getAllEvents(db: Database): readonly EventConnection[] {
	const rows = db
		.query(
			`SELECT e.value AS event_name,
				emitter.name AS emitter_name, emitter.file AS emitter_file,
				handler.name AS handler_name, handler.file AS handler_file
			FROM tags e
			JOIN tags h ON e.value = h.value AND h.kind = 'handles'
			JOIN nodes emitter ON e.node_id = emitter.id
			JOIN nodes handler ON h.node_id = handler.id
			WHERE e.kind = 'emits'
			ORDER BY e.value`,
		)
		.all() as {
		event_name: string;
		emitter_name: string;
		emitter_file: string;
		handler_name: string;
		handler_file: string;
	}[];
	return rows.map((row) => ({
		eventName: row.event_name,
		emitterName: row.emitter_name,
		emitterFile: row.emitter_file,
		handlerName: row.handler_name,
		handlerFile: row.handler_file,
	}));
}

/**
 * Finds all paths from a source node to a target node using DFS with backtracking.
 * Traverses calls and event edges. Cycle-aware via visited set.
 *
 * @param db - An open Database handle
 * @param sourceId - Starting node ID
 * @param targetId - Target node ID
 * @returns All distinct paths as arrays of node IDs
 */
function findAllPaths(
	db: Database,
	sourceId: string,
	targetId: string,
): readonly (readonly string[])[] {
	// Build adjacency list in memory for efficient traversal
	const edges = db
		.query("SELECT source_id, target_id FROM edges WHERE kind IN ('calls', 'event')")
		.all() as { source_id: string; target_id: string }[];

	const adjacency = new Map<string, string[]>();
	for (const edge of edges) {
		const existing = adjacency.get(edge.source_id);
		if (existing) {
			existing.push(edge.target_id);
		} else {
			adjacency.set(edge.source_id, [edge.target_id]);
		}
	}

	const results: string[][] = [];
	const visited = new Set<string>();

	function dfs(current: string, path: string[]): void {
		if (current === targetId) {
			results.push([...path]);
			return;
		}

		const neighbors = adjacency.get(current);
		if (!neighbors) return;

		for (const neighbor of neighbors) {
			if (!visited.has(neighbor)) {
				visited.add(neighbor);
				path.push(neighbor);
				dfs(neighbor, path);
				path.pop();
				visited.delete(neighbor);
			}
		}
	}

	visited.add(sourceId);
	dfs(sourceId, [sourceId]);

	return results;
}

export {
	type BoundaryEntry,
	type EventConnection,
	type FlowEntry,
	findAllPaths,
	getAllBoundaries,
	getAllEvents,
	getAllFlows,
	getCallees,
	getCallers,
	getFlowMembers,
	getFlowsForNode,
	getImpact,
	resolveSymbol,
};
