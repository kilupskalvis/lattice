import type { Database } from "bun:sqlite";
import type { Edge, ExternalCall, Node, Tag } from "../types/graph.ts";

/**
 * Inserts nodes into the graph database.
 * Uses INSERT OR REPLACE to handle re-indexing.
 *
 * @param db - An open Database handle
 * @param nodes - Nodes to insert
 */
function insertNodes(db: Database, nodes: readonly Node[]): void {
	const stmt = db.prepare(
		"INSERT OR REPLACE INTO nodes (id, kind, name, file, line_start, line_end, language, signature, is_test, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	);
	const tx = db.transaction(() => {
		for (const node of nodes) {
			stmt.run(
				node.id,
				node.kind,
				node.name,
				node.file,
				node.lineStart,
				node.lineEnd,
				node.language,
				node.signature ?? null,
				node.isTest ? 1 : 0,
				node.metadata ? JSON.stringify(node.metadata) : null,
			);
		}
	});
	tx();
}

/**
 * Inserts edges into the graph database.
 * Uses INSERT OR IGNORE to skip duplicates.
 *
 * @param db - An open Database handle
 * @param edges - Edges to insert
 */
function insertEdges(db: Database, edges: readonly Edge[]): void {
	const stmt = db.prepare(
		"INSERT OR IGNORE INTO edges (source_id, target_id, kind) VALUES (?, ?, ?)",
	);
	const tx = db.transaction(() => {
		for (const edge of edges) {
			stmt.run(edge.sourceId, edge.targetId, edge.kind);
		}
	});
	tx();
}

/**
 * Inserts tags into the graph database.
 * Uses INSERT OR IGNORE to skip duplicates.
 *
 * @param db - An open Database handle
 * @param tags - Tags to insert
 */
function insertTags(db: Database, tags: readonly Tag[]): void {
	const stmt = db.prepare("INSERT OR IGNORE INTO tags (node_id, kind, value) VALUES (?, ?, ?)");
	const tx = db.transaction(() => {
		for (const tag of tags) {
			stmt.run(tag.nodeId, tag.kind, tag.value);
		}
	});
	tx();
}

/**
 * Inserts external call records for lint boundary detection.
 * Uses INSERT OR IGNORE to skip duplicates.
 *
 * @param db - An open Database handle
 * @param calls - External calls to insert
 */
function insertExternalCalls(db: Database, calls: readonly ExternalCall[]): void {
	const stmt = db.prepare(
		"INSERT OR IGNORE INTO external_calls (node_id, package, symbol) VALUES (?, ?, ?)",
	);
	const tx = db.transaction(() => {
		for (const call of calls) {
			stmt.run(call.nodeId, call.package, call.symbol);
		}
	});
	tx();
}

/**
 * Deletes all nodes, edges, tags, and external calls for a given file.
 * Edges where the file's nodes are either source or target are removed.
 *
 * @param db - An open Database handle
 * @param file - Relative file path to delete data for
 */
function deleteFileData(db: Database, file: string): void {
	const tx = db.transaction(() => {
		const nodeIds = db.query("SELECT id FROM nodes WHERE file = ?").all(file) as {
			id: string;
		}[];
		const ids = nodeIds.map((n) => n.id);

		if (ids.length > 0) {
			const placeholders = ids.map(() => "?").join(",");
			db.run(`DELETE FROM tags WHERE node_id IN (${placeholders})`, ids);
			db.run(`DELETE FROM edges WHERE source_id IN (${placeholders})`, ids);
			db.run(`DELETE FROM edges WHERE target_id IN (${placeholders})`, ids);
			db.run(`DELETE FROM external_calls WHERE node_id IN (${placeholders})`, ids);
			db.run(`DELETE FROM nodes WHERE id IN (${placeholders})`, ids);
		}
	});
	tx();
}

/**
 * Creates synthetic event edges from @lattice:emits to @lattice:handles.
 * Deletes all existing event edges first, then recreates from current tags.
 * This ensures event edges stay consistent after any tag changes.
 *
 * @param db - An open Database handle
 */
function synthesizeEventEdges(db: Database): void {
	const tx = db.transaction(() => {
		db.run("DELETE FROM edges WHERE kind = 'event'");
		db.run(`
			INSERT OR IGNORE INTO edges (source_id, target_id, kind)
			SELECT e.node_id, h.node_id, 'event'
			FROM tags e
			JOIN tags h ON e.value = h.value
			WHERE e.kind = 'emits' AND h.kind = 'handles'
		`);
	});
	tx();
}

export {
	deleteFileData,
	insertEdges,
	insertExternalCalls,
	insertNodes,
	insertTags,
	synthesizeEventEdges,
};
