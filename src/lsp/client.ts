import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import type {
	CallHierarchyItem,
	CallHierarchyOutgoingCall,
	DocumentSymbol,
	JsonRpcMessage,
} from "./types.ts";

/** Options for creating an LSP client. */
type LspClientOptions = {
	readonly command: string;
	readonly args: readonly string[];
	readonly rootUri: string;
	readonly languageId?: string;
};

/** An LSP client that communicates with a language server over stdio. */
type LspClient = {
	/** Waits for the server to be ready by probing a known file. */
	waitForReady(filePath: string): Promise<void>;
	/** Returns all symbols in a file. */
	documentSymbol(filePath: string): Promise<readonly DocumentSymbol[]>;
	/** Prepares a call hierarchy item at a position. */
	prepareCallHierarchy(
		filePath: string,
		line: number,
		character: number,
	): Promise<readonly CallHierarchyItem[]>;
	/** Returns outgoing calls from a call hierarchy item. */
	outgoingCalls(item: CallHierarchyItem): Promise<readonly CallHierarchyOutgoingCall[]>;
	/** Shuts down the language server and kills the process. */
	shutdown(): Promise<void>;
};

/**
 * Creates an LSP client by spawning a language server process.
 * Sends initialize/initialized, waits for readiness, then returns the client handle.
 *
 * @param opts - Server command, args, and project root URI
 * @returns A ready LSP client
 */
async function createLspClient(opts: LspClientOptions): Promise<LspClient> {
	let nextId = 1;
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	let buffer = "";
	const openedFiles = new Set<string>();

	const proc: ChildProcess = spawn(opts.command, [...opts.args], {
		stdio: ["pipe", "pipe", "pipe"],
	});

	if (!proc.stdin || !proc.stdout) {
		throw new Error(`Failed to spawn ${opts.command}`);
	}

	// Parse incoming JSON-RPC messages from stdout
	proc.stdout.on("data", (chunk: Buffer) => {
		buffer += chunk.toString();
		while (true) {
			const headerEnd = buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) break;

			const header = buffer.slice(0, headerEnd);
			const match = header.match(/Content-Length:\s*(\d+)/i);
			if (!match) {
				buffer = buffer.slice(headerEnd + 4);
				continue;
			}

			const contentLength = Number.parseInt(match[1] as string, 10);
			const bodyStart = headerEnd + 4;
			if (buffer.length < bodyStart + contentLength) break;

			const body = buffer.slice(bodyStart, bodyStart + contentLength);
			buffer = buffer.slice(bodyStart + contentLength);

			try {
				const msg = JSON.parse(body) as JsonRpcMessage;
				if (msg.id !== undefined && pending.has(msg.id)) {
					const handler = pending.get(msg.id);
					pending.delete(msg.id);
					if (msg.error) {
						handler?.reject(new Error(`LSP error: ${msg.error.message}`));
					} else {
						handler?.resolve(msg.result);
					}
				}
			} catch {
				// Ignore malformed messages
			}
		}
	});

	function sendRequest(method: string, params: unknown): Promise<unknown> {
		const id = nextId++;
		const msg: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
		const body = JSON.stringify(msg);
		const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
		proc.stdin?.write(header + body);

		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
		});
	}

	function sendNotification(method: string, params: unknown): void {
		const msg = { jsonrpc: "2.0", method, params };
		const body = JSON.stringify(msg);
		const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
		proc.stdin?.write(header + body);
	}

	const langId = opts.languageId ?? "typescript";

	function openFile(filePath: string): void {
		const uri = `file://${filePath}`;
		if (openedFiles.has(uri)) return;
		openedFiles.add(uri);

		const text = readFileSync(filePath, "utf-8");
		sendNotification("textDocument/didOpen", {
			textDocument: { uri, languageId: langId, version: 1, text },
		});
	}

	// Initialize
	await sendRequest("initialize", {
		processId: process.pid,
		rootUri: opts.rootUri,
		capabilities: {
			textDocument: {
				documentSymbol: { hierarchicalDocumentSymbolSupport: true },
				callHierarchy: { dynamicRegistration: false },
			},
		},
	});

	sendNotification("initialized", {});

	const client: LspClient = {
		async waitForReady(probePath: string): Promise<void> {
			openFile(probePath);
			const delays = [100, 200, 400, 800, 1600, 3200];
			for (const delay of delays) {
				const result = (await sendRequest("textDocument/documentSymbol", {
					textDocument: { uri: `file://${probePath}` },
				})) as readonly DocumentSymbol[] | null;
				if (result && result.length > 0) return;
				await new Promise((r) => setTimeout(r, delay));
			}
		},

		async documentSymbol(filePath: string): Promise<readonly DocumentSymbol[]> {
			openFile(filePath);
			const result = await sendRequest("textDocument/documentSymbol", {
				textDocument: { uri: `file://${filePath}` },
			});
			return (result as readonly DocumentSymbol[]) ?? [];
		},

		async prepareCallHierarchy(
			filePath: string,
			line: number,
			character: number,
		): Promise<readonly CallHierarchyItem[]> {
			openFile(filePath);
			const result = await sendRequest("textDocument/prepareCallHierarchy", {
				textDocument: { uri: `file://${filePath}` },
				position: { line, character },
			});
			return (result as readonly CallHierarchyItem[]) ?? [];
		},

		async outgoingCalls(item: CallHierarchyItem): Promise<readonly CallHierarchyOutgoingCall[]> {
			const result = await sendRequest("callHierarchy/outgoingCalls", { item });
			return (result as readonly CallHierarchyOutgoingCall[]) ?? [];
		},

		async shutdown(): Promise<void> {
			try {
				await sendRequest("shutdown", null);
				sendNotification("exit", null);
			} catch {
				// Server may already be dead
			}
			proc.kill();
		},
	};

	return client;
}

export { createLspClient, type LspClient, type LspClientOptions };
