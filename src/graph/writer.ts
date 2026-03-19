import type { Database } from "bun:sqlite";
import type { Edge, Node, Tag, UnresolvedReference } from "../types/graph.ts";

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
		"INSERT OR IGNORE INTO edges (source_id, target_id, kind, certainty) VALUES (?, ?, ?, ?)",
	);
	const tx = db.transaction(() => {
		for (const edge of edges) {
			stmt.run(edge.sourceId, edge.targetId, edge.kind, edge.certainty);
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
 * Inserts unresolved references into the database.
 * Uses INSERT OR IGNORE to skip duplicates.
 *
 * @param db - An open Database handle
 * @param refs - Unresolved references to insert
 */
function insertUnresolved(db: Database, refs: readonly UnresolvedReference[]): void {
	const stmt = db.prepare(
		"INSERT OR IGNORE INTO unresolved (file, line, expression, reason) VALUES (?, ?, ?, ?)",
	);
	const tx = db.transaction(() => {
		for (const ref of refs) {
			stmt.run(ref.file, ref.line, ref.expression, ref.reason);
		}
	});
	tx();
}

/**
 * Deletes all nodes, edges, tags, and unresolved references for a given file.
 * Edges where the file's nodes are either source or target are removed.
 *
 * @param db - An open Database handle
 * @param file - Relative file path to delete data for
 */
function deleteFileData(db: Database, file: string): void {
	const tx = db.transaction(() => {
		// Get node IDs for this file
		const nodeIds = db.query("SELECT id FROM nodes WHERE file = ?").all(file) as { id: string }[];
		const ids = nodeIds.map((n) => n.id);

		if (ids.length > 0) {
			const placeholders = ids.map(() => "?").join(",");
			// Delete tags for these nodes
			db.run(`DELETE FROM tags WHERE node_id IN (${placeholders})`, ids);
			// Delete edges where these nodes are source or target
			db.run(`DELETE FROM edges WHERE source_id IN (${placeholders})`, ids);
			db.run(`DELETE FROM edges WHERE target_id IN (${placeholders})`, ids);
			// Delete the nodes themselves
			db.run(`DELETE FROM nodes WHERE id IN (${placeholders})`, ids);
		}

		// Delete unresolved references for this file
		db.run("DELETE FROM unresolved WHERE file = ?", [file]);
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
			INSERT OR IGNORE INTO edges (source_id, target_id, kind, certainty)
			SELECT e.node_id, h.node_id, 'event', 'certain'
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
	insertNodes,
	insertTags,
	insertUnresolved,
	synthesizeEventEdges,
};
