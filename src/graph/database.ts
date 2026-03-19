import { Database } from "bun:sqlite";
import { err, ok, type Result } from "../types/result.ts";

const SCHEMA_VERSION = "1";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
	id          TEXT PRIMARY KEY,
	kind        TEXT NOT NULL,
	name        TEXT NOT NULL,
	file        TEXT NOT NULL,
	line_start  INTEGER NOT NULL,
	line_end    INTEGER NOT NULL,
	language    TEXT NOT NULL,
	signature   TEXT,
	is_test     INTEGER DEFAULT 0,
	metadata    TEXT
);

CREATE TABLE IF NOT EXISTS edges (
	source_id   TEXT NOT NULL REFERENCES nodes(id),
	target_id   TEXT NOT NULL REFERENCES nodes(id),
	kind        TEXT NOT NULL,
	certainty   TEXT DEFAULT 'certain',
	PRIMARY KEY (source_id, target_id, kind)
);

CREATE TABLE IF NOT EXISTS tags (
	node_id     TEXT NOT NULL REFERENCES nodes(id),
	kind        TEXT NOT NULL,
	value       TEXT NOT NULL,
	PRIMARY KEY (node_id, kind, value)
);

CREATE TABLE IF NOT EXISTS unresolved (
	file        TEXT NOT NULL,
	line        INTEGER NOT NULL,
	expression  TEXT NOT NULL,
	reason      TEXT NOT NULL,
	PRIMARY KEY (file, line, expression)
);

CREATE TABLE IF NOT EXISTS meta (
	key         TEXT PRIMARY KEY,
	value       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id, kind);
CREATE INDEX IF NOT EXISTS idx_tags_kind_value ON tags(kind, value);
CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
`;

/**
 * Creates or opens a SQLite database with the Lattice schema.
 * Uses WAL mode for concurrent read performance.
 *
 * @param path - File path for the database, or ":memory:" for in-memory
 * @returns An open Database handle with the schema applied
 */
function createDatabase(path: string): Database {
	const db = new Database(path);
	db.run("PRAGMA journal_mode = WAL");
	db.run("PRAGMA foreign_keys = ON");
	for (const statement of SCHEMA_SQL.split(";").filter((s) => s.trim())) {
		db.run(`${statement};`);
	}
	db.run("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)", [SCHEMA_VERSION]);
	return db;
}

/**
 * Validates that the database schema version matches the expected version.
 *
 * @param db - An open Database handle
 * @returns Ok if versions match, Err with a message if they don't
 */
function checkSchemaVersion(db: Database): Result<undefined, string> {
	const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as {
		value: string;
	} | null;
	if (!row) {
		return err("No schema_version found in database");
	}
	if (row.value !== SCHEMA_VERSION) {
		return err(
			`Schema version mismatch: expected ${SCHEMA_VERSION}, found ${row.value}. Run 'lattice build' to rebuild.`,
		);
	}
	return ok(undefined);
}

export { checkSchemaVersion, createDatabase, SCHEMA_VERSION };
