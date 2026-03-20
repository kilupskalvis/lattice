import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createLspClient, type LspClient } from "../../src/lsp/client.ts";

const FIXTURE_DIR = resolve(import.meta.dir, "../fixtures/ts-simple");
const FIXTURE_FILE = resolve(FIXTURE_DIR, "main.ts");

describe("LspClient", () => {
	let client: LspClient;

	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"initializes and shuts down cleanly",
		async () => {
			client = await createLspClient({
				command: "typescript-language-server",
				args: ["--stdio"],
				rootUri: `file://${FIXTURE_DIR}`,
			});
			expect(client).toBeDefined();
		},
		15000,
	);

	test(
		"documentSymbol returns symbols for a file",
		async () => {
			client = await createLspClient({
				command: "typescript-language-server",
				args: ["--stdio"],
				rootUri: `file://${FIXTURE_DIR}`,
			});
			await client.waitForReady(FIXTURE_FILE);
			const symbols = await client.documentSymbol(FIXTURE_FILE);
			const names = symbols.map((s) => s.name);
			expect(names).toContain("greet");
			expect(names).toContain("formatGreeting");
		},
		15000,
	);

	test(
		"prepareCallHierarchy returns items for a function",
		async () => {
			client = await createLspClient({
				command: "typescript-language-server",
				args: ["--stdio"],
				rootUri: `file://${FIXTURE_DIR}`,
			});
			await client.waitForReady(FIXTURE_FILE);
			// greet is at line 0, character 9 (0-based)
			const items = await client.prepareCallHierarchy(FIXTURE_FILE, 0, 9);
			expect(items.length).toBeGreaterThan(0);
			expect(items[0]?.name).toBe("greet");
		},
		15000,
	);

	test(
		"outgoingCalls returns calls from a function",
		async () => {
			client = await createLspClient({
				command: "typescript-language-server",
				args: ["--stdio"],
				rootUri: `file://${FIXTURE_DIR}`,
			});
			await client.waitForReady(FIXTURE_FILE);
			const items = await client.prepareCallHierarchy(FIXTURE_FILE, 0, 9);
			expect(items.length).toBeGreaterThan(0);
			const calls = await client.outgoingCalls(items[0]!);
			expect(calls.length).toBeGreaterThan(0);
			expect(calls[0]?.to.name).toBe("formatGreeting");
		},
		15000,
	);
});
