import { describe, expect, it } from "bun:test";
import { checkSchemaVersion, createDatabase } from "../../src/graph/database.ts";
import { isOk } from "../../src/types/result.ts";

describe("createDatabase", () => {
	it("creates an in-memory database with all tables", () => {
		const db = createDatabase(":memory:");
		const tables = db
			.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all() as { name: string }[];
		const tableNames = tables.map((t) => t.name);
		expect(tableNames).toContain("nodes");
		expect(tableNames).toContain("edges");
		expect(tableNames).toContain("tags");
		expect(tableNames).toContain("unresolved");
		expect(tableNames).toContain("meta");
		db.close();
	});

	it("creates all indexes", () => {
		const db = createDatabase(":memory:");
		const indexes = db
			.query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
			.all() as { name: string }[];
		const indexNames = indexes.map((i) => i.name);
		expect(indexNames).toContain("idx_edges_source");
		expect(indexNames).toContain("idx_edges_target");
		expect(indexNames).toContain("idx_tags_kind_value");
		expect(indexNames).toContain("idx_nodes_file");
		expect(indexNames).toContain("idx_nodes_name");
		db.close();
	});

	it("populates meta with schema_version", () => {
		const db = createDatabase(":memory:");
		const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as {
			value: string;
		} | null;
		expect(row).not.toBeNull();
		expect(row?.value).toBe("1");
		db.close();
	});

	it("is idempotent — creating twice does not error", () => {
		const db = createDatabase(":memory:");
		expect(() => createDatabase(":memory:")).not.toThrow();
		db.close();
	});

	it("sets WAL mode for file-based databases", () => {
		const tmp = `${import.meta.dir}/../.tmp-test-${Date.now()}.db`;
		try {
			const db = createDatabase(tmp);
			const row = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
			expect(row.journal_mode).toBe("wal");
			db.close();
		} finally {
			try {
				Bun.file(tmp).exists();
				const { unlinkSync } = require("node:fs");
				unlinkSync(tmp);
				unlinkSync(`${tmp}-shm`);
				unlinkSync(`${tmp}-wal`);
			} catch {
				// cleanup best-effort
			}
		}
	});
});

describe("checkSchemaVersion", () => {
	it("returns ok for matching version", () => {
		const db = createDatabase(":memory:");
		const result = checkSchemaVersion(db);
		expect(isOk(result)).toBe(true);
		db.close();
	});

	it("returns err for mismatched version", () => {
		const db = createDatabase(":memory:");
		db.run("UPDATE meta SET value = '999' WHERE key = 'schema_version'");
		const result = checkSchemaVersion(db);
		expect(isOk(result)).toBe(false);
		db.close();
	});
});
