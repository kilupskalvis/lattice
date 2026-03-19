import { describe, expect, it } from "bun:test";
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeBuild } from "../../src/commands/build.ts";
import { executeUpdate } from "../../src/commands/update.ts";
import type { LatticeConfig } from "../../src/types/config.ts";
import { isOk, unwrap } from "../../src/types/result.ts";

const TMP_DIR = "tests/fixtures/.tmp-update-test";
const FIXTURE_SRC = "tests/fixtures/python-fastapi";

const config: LatticeConfig = {
	languages: ["python"],
	root: "src",
	exclude: [],
	python: { sourceRoots: ["src"], testPaths: ["tests"] },
	typescript: undefined,
	lint: { strict: false, ignore: [] },
};

function setup(): void {
	cleanup();
	cpSync(FIXTURE_SRC, TMP_DIR, { recursive: true });
}

function cleanup(): void {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
}

describe("executeUpdate", () => {
	it("re-indexes only changed files", async () => {
		setup();
		// Initial build
		const buildResult = await executeBuild(TMP_DIR, config);
		expect(isOk(buildResult)).toBe(true);

		// Touch a file to mark it as changed
		const filePath = join(TMP_DIR, "src/gateways/payment.py");
		const content = await Bun.file(filePath).text();
		// Wait briefly to ensure mtime differs
		await Bun.sleep(100);
		writeFileSync(filePath, content);

		// Run update
		const updateResult = await executeUpdate(TMP_DIR, config);
		expect(isOk(updateResult)).toBe(true);
		const stats = unwrap(updateResult);
		// Should re-index at least the changed file
		expect(stats.filesReindexed).toBeGreaterThan(0);
		expect(stats.filesReindexed).toBeLessThan(stats.totalFiles);

		cleanup();
	});

	it("produces same result as full build", async () => {
		setup();
		// Initial build
		await executeBuild(TMP_DIR, config);

		// Touch a file
		const filePath = join(TMP_DIR, "src/gateways/payment.py");
		await Bun.sleep(100);
		writeFileSync(
			filePath,
			`import stripe

# @lattice:boundary stripe
def charge(amount: float, token: str) -> dict:
    return stripe.charges.create(amount=amount, source=token)
`,
		);

		// Update
		await executeUpdate(TMP_DIR, config);

		// Full rebuild for comparison
		const freshResult = await executeBuild(TMP_DIR, config);
		const freshStats = unwrap(freshResult);

		// Read node count from the database
		const { Database } = await import("bun:sqlite");
		const db = new Database(join(TMP_DIR, ".lattice/graph.db"), { readonly: true });
		const nodeCount = (db.query("SELECT COUNT(*) as c FROM nodes").get() as { c: number }).c;
		db.close();

		expect(nodeCount).toBe(freshStats.nodeCount);
		cleanup();
	});

	it("returns error when no prior build exists", async () => {
		setup();
		// Remove .lattice directory if it exists
		const latticeDir = join(TMP_DIR, ".lattice");
		if (existsSync(latticeDir)) rmSync(latticeDir, { recursive: true });

		const result = await executeUpdate(TMP_DIR, config);
		expect(isOk(result)).toBe(false);
		cleanup();
	});

	it("rebuilds event edges after update", async () => {
		setup();
		await executeBuild(TMP_DIR, config);

		// Touch the events file
		const filePath = join(TMP_DIR, "src/services/order.py");
		await Bun.sleep(100);
		writeFileSync(filePath, await Bun.file(filePath).text());

		await executeUpdate(TMP_DIR, config);

		const { Database } = await import("bun:sqlite");
		const db = new Database(join(TMP_DIR, ".lattice/graph.db"), { readonly: true });
		const eventEdges = (
			db.query("SELECT COUNT(*) as c FROM edges WHERE kind = 'event'").get() as { c: number }
		).c;
		db.close();
		expect(eventEdges).toBeGreaterThan(0);

		cleanup();
	});
});
