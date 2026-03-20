#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { executeBuild } from "./commands/build.ts";
import { executeInit } from "./commands/init.ts";
import { executeLint } from "./commands/lint.ts";
import { executePopulate } from "./commands/populate.ts";
import { executeUpdate } from "./commands/update.ts";
import { parseConfig } from "./config.ts";
import { checkSchemaVersion } from "./graph/database.ts";
import {
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
} from "./graph/queries.ts";
import { formatContextJson, formatOverviewJson } from "./output/json.ts";
import {
	type FlowTreeNode,
	formatBoundaries,
	formatCallees,
	formatCallers,
	formatContext,
	formatEvents,
	formatFlowTree,
	formatImpact,
	formatOverview,
} from "./output/text.ts";
import type { Node } from "./types/graph.ts";
import { isOk, unwrap } from "./types/result.ts";

const VERSION = "0.3.0";

const program = new Command();
program.name("lattice").description("Knowledge graph CLI for coding agents").version(VERSION);

/** Loads config from lattice.toml in the given directory. */
function loadConfig(dir: string): ReturnType<typeof parseConfig> {
	const tomlPath = join(dir, "lattice.toml");
	try {
		const toml = readFileSync(tomlPath, "utf-8");
		return parseConfig(toml);
	} catch {
		return { ok: false, error: `Cannot read ${tomlPath}` };
	}
}

/** Opens the graph database for query commands. */
function openDb(dir: string): Database {
	const dbPath = join(dir, ".lattice", "graph.db");
	const db = new Database(dbPath, { readonly: true });
	const check = checkSchemaVersion(db);
	if (!isOk(check)) {
		db.close();
		throw new Error(unwrap(check));
	}
	return db;
}

// --- init ---
program
	.command("init")
	.description("Initialize .lattice/ in a project, detect languages")
	.action(() => {
		const cwd = process.cwd();
		const result = executeInit(cwd);
		if (isOk(result)) {
			console.log(unwrap(result));
		} else {
			console.error(result.error);
			process.exit(1);
		}
	});

// --- build ---
program
	.command("build")
	.description("Full index: parse all files, resolve imports, build graph")
	.action(async () => {
		const cwd = process.cwd();
		const configResult = loadConfig(cwd);
		if (!isOk(configResult)) {
			console.error(configResult.error);
			process.exit(1);
		}
		const config = unwrap(configResult);
		const result = await executeBuild(cwd, config);
		if (isOk(result)) {
			const stats = unwrap(result);
			console.log(
				`Built graph: ${stats.fileCount} files, ${stats.nodeCount} nodes, ${stats.edgeCount} edges, ${stats.tagCount} tags (${stats.durationMs}ms)`,
			);
		} else {
			console.error(result.error);
			process.exit(1);
		}
	});

// --- lint ---
program
	.command("lint")
	.description("Validate tags: syntax, typos, orphans, missing tags")
	.option("--strict", "Treat warnings as errors")
	.action((opts: { strict?: boolean }) => {
		const cwd = process.cwd();
		const configResult = loadConfig(cwd);
		if (!isOk(configResult)) {
			console.error(configResult.error);
			process.exit(1);
		}
		const config = unwrap(configResult);
		const db = openDb(cwd);
		const result = executeLint(db, config);

		// Print issues
		const errors = result.issues.filter((i) => i.severity === "error");
		const warnings = result.issues.filter((i) => i.severity === "warning");

		if (errors.length > 0) {
			console.log("Errors (must fix):");
			for (const issue of errors) {
				console.log(`  ${issue.file}:${issue.line}  ${issue.symbol}`);
				console.log(`    ${issue.message}`);
				console.log();
			}
		}

		if (warnings.length > 0) {
			console.log("Warnings (should fix):");
			for (const issue of warnings) {
				console.log(`  ${issue.file}:${issue.line}  ${issue.symbol}`);
				console.log(`    ${issue.message}`);
				console.log();
			}
		}

		// Coverage info
		console.log(
			`Info:\n  Coverage: ${result.coverage.tagged}/${result.coverage.total} entry points tagged (${result.coverage.total > 0 ? Math.round((result.coverage.tagged / result.coverage.total) * 100) : 0}%)`,
		);
		db.close();

		// Exit code
		const hasErrors = errors.length > 0;
		const hasWarnings = warnings.length > 0;
		if (hasErrors || (opts.strict && hasWarnings)) {
			process.exit(1);
		}
	});

// --- update ---
program
	.command("update")
	.description("Incremental: re-index only files changed since last build")
	.action(async () => {
		const cwd = process.cwd();
		const configResult = loadConfig(cwd);
		if (!isOk(configResult)) {
			console.error(configResult.error);
			process.exit(1);
		}
		const config = unwrap(configResult);
		const result = await executeUpdate(cwd, config);
		if (isOk(result)) {
			const stats = unwrap(result);
			console.log(
				`Updated: ${stats.filesReindexed}/${stats.totalFiles} files re-indexed (${stats.durationMs}ms)`,
			);
		} else {
			console.error(result.error);
			process.exit(1);
		}
	});

// --- populate ---
program
	.command("populate")
	.description("Output agent instructions for tagging the codebase")
	.action(() => {
		const cwd = process.cwd();
		const configResult = loadConfig(cwd);
		if (!isOk(configResult)) {
			console.error(configResult.error);
			process.exit(1);
		}
		const config = unwrap(configResult);
		const db = openDb(cwd);
		const output = executePopulate(db, config);
		db.close();
		console.log(output);
	});

// --- overview ---
program
	.command("overview")
	.description("Project landscape: flows, boundaries, event connections")
	.option("--json", "Output as JSON")
	.action((opts: { json?: boolean }) => {
		const db = openDb(process.cwd());
		const flows = getAllFlows(db);
		const boundaries = getAllBoundaries(db);
		const events = getAllEvents(db);
		db.close();

		if (opts.json) {
			console.log(formatOverviewJson(flows, boundaries, events));
		} else {
			console.log(formatOverview(flows, boundaries, events));
		}
	});

// --- flows ---
program
	.command("flows")
	.description("List all flows with their entry points")
	.action(() => {
		const db = openDb(process.cwd());
		const flows = getAllFlows(db);
		db.close();

		for (const flow of flows) {
			const route = flow.node.metadata?.route;
			const routeStr = route ? `→ ${route} ` : "→ ";
			console.log(`${flow.value.padEnd(20)} ${routeStr}(${flow.node.file}:${flow.node.lineStart})`);
		}
	});

// --- flow <name> ---
program
	.command("flow <name>")
	.description("Full call tree from a flow's entry point to its boundaries")
	.action((name: string) => {
		const db = openDb(process.cwd());
		const members = getFlowMembers(db, name);
		if (members.length === 0) {
			db.close();
			console.log(`Unknown flow: ${name}`);
			process.exit(1);
		}

		// Build call tree from entry points
		const flows = getAllFlows(db);
		const entryPoints = flows.filter((f) => f.value === name).map((f) => f.node);
		const boundaries = getAllBoundaries(db);
		const boundaryMap = new Map(boundaries.map((b) => [b.node.id, b.value]));

		for (const entry of entryPoints) {
			const tree = buildFlowTree(db, entry, boundaryMap, new Set());
			console.log(formatFlowTree(tree));
		}
		db.close();
	});

// --- context <symbol> ---
program
	.command("context <symbol>")
	.description("Symbol neighborhood: callers, callees, flows, boundaries")
	.option("--json", "Output as JSON")
	.action((symbol: string, opts: { json?: boolean }) => {
		const db = openDb(process.cwd());
		const nodes = resolveSymbol(db, symbol);

		if (nodes.length === 0) {
			db.close();
			console.log(`Unknown symbol: ${symbol}`);
			process.exit(1);
		}

		if (nodes.length > 1) {
			db.close();
			console.log("Ambiguous symbol. Matches:");
			for (const n of nodes) {
				console.log(`  ${n.id}`);
			}
			process.exit(1);
		}

		const node = nodes[0];
		if (!node) {
			db.close();
			console.error("Symbol resolution failed");
			process.exit(1);
		}
		const callers = getCallers(db, node.id);
		const callees = getCallees(db, node.id);
		const flowNames = getFlowsForNode(db, node.id);
		const allBoundaries = getAllBoundaries(db);
		const boundary = allBoundaries.find((b) => b.node.id === node.id)?.value;
		db.close();

		const data = { node, flows: flowNames, callers: [...callers], callees: [...callees], boundary };
		if (opts.json) {
			console.log(formatContextJson(data));
		} else {
			console.log(formatContext(data));
		}
	});

// --- callers <symbol> ---
program
	.command("callers <symbol>")
	.description("What calls this symbol (reverse edges)")
	.action((symbol: string) => {
		const db = openDb(process.cwd());
		const node = resolveOne(db, symbol);
		const callers = getCallers(db, node.id);
		db.close();
		console.log(formatCallers([...callers]));
	});

// --- callees <symbol> ---
program
	.command("callees <symbol>")
	.description("What this symbol calls (forward edges)")
	.action((symbol: string) => {
		const db = openDb(process.cwd());
		const node = resolveOne(db, symbol);
		const callees = getCallees(db, node.id);
		db.close();
		console.log(formatCallees([...callees]));
	});

// --- trace <flow> --to <boundary> ---
program
	.command("trace <flow>")
	.description("Call chain from flow entry to a specific boundary")
	.requiredOption("--to <boundary>", "Target boundary system name")
	.action((flowName: string, opts: { to: string }) => {
		const db = openDb(process.cwd());
		const flows = getAllFlows(db);
		const entries = flows.filter((f) => f.value === flowName);
		if (entries.length === 0) {
			db.close();
			console.log(`Unknown flow: ${flowName}`);
			process.exit(1);
		}

		const boundaries = getAllBoundaries(db);
		const targets = boundaries.filter((b) => b.value === opts.to);
		if (targets.length === 0) {
			db.close();
			console.log(`Unknown boundary: ${opts.to}`);
			process.exit(1);
		}

		let found = false;
		for (const entry of entries) {
			for (const target of targets) {
				const paths = findAllPaths(db, entry.node.id, target.node.id);
				for (const path of paths) {
					found = true;
					const pathNodes = path
						.map((id) => resolveSymbol(db, id))
						.filter((n) => n.length > 0)
						.map((n) => n[0])
						.filter((n): n is Node => n !== undefined);
					for (let i = 0; i < pathNodes.length; i++) {
						const indent = i === 0 ? "" : `${"  ".repeat(i)}→ `;
						const boundaryTag = boundaries.find((b) => b.node.id === pathNodes[i]?.id);
						const suffix = boundaryTag ? ` [${boundaryTag.value}]` : "";
						console.log(
							`${indent}${pathNodes[i]?.name} (${pathNodes[i]?.file}:${pathNodes[i]?.lineStart})${suffix}`,
						);
					}
				}
			}
		}

		if (!found) {
			console.log(`No path from ${flowName} to ${opts.to}`);
		}
		db.close();
	});

// --- impact <symbol> ---
program
	.command("impact <symbol>")
	.description("Everything affected if this symbol changes")
	.action((symbol: string) => {
		const db = openDb(process.cwd());
		const node = resolveOne(db, symbol);
		const directCallers = [...getCallers(db, node.id)];
		const allUpstream = [...getImpact(db, node.id)];
		const transitiveCallers = allUpstream.filter((n) => !directCallers.some((d) => d.id === n.id));
		const affectedFlows = [...new Set(allUpstream.flatMap((n) => [...getFlowsForNode(db, n.id)]))];
		const affectedTests = allUpstream.filter((n) => n.isTest);
		db.close();

		console.log(formatImpact({ directCallers, transitiveCallers, affectedFlows, affectedTests }));
	});

// --- boundaries ---
program
	.command("boundaries")
	.description("All external system boundaries")
	.action(() => {
		const db = openDb(process.cwd());
		const boundaries = getAllBoundaries(db);
		db.close();
		console.log(formatBoundaries([...boundaries]));
	});

// --- events ---
program
	.command("events")
	.description("All event connections (emits → handles)")
	.action(() => {
		const db = openDb(process.cwd());
		const events = getAllEvents(db);
		db.close();
		console.log(formatEvents([...events]));
	});

// --- code <symbol> ---
program
	.command("code <symbol>")
	.description("Source code of a specific function/method")
	.action((symbol: string) => {
		const db = openDb(process.cwd());
		const node = resolveOne(db, symbol);
		db.close();

		const fullPath = resolve(process.cwd(), node.file);
		const source = readFileSync(fullPath, "utf-8");
		const lines = source.split("\n");

		// Expand upward to include lattice tags and decorators
		let start = node.lineStart - 1; // 0-based
		while (start > 0) {
			const line = lines[start - 1]?.trim();
			if (!line) break;
			if (
				line.startsWith("#") ||
				line.startsWith("//") ||
				line.startsWith("@") ||
				line.startsWith("/*")
			) {
				start--;
			} else {
				break;
			}
		}

		const codeLines = lines.slice(start, node.lineEnd);
		console.log(`# ${node.file}:${start + 1}-${node.lineEnd}\n`);
		console.log(codeLines.join("\n"));
	});

/** Resolves a symbol to exactly one node. Exits on ambiguity or not found. */
function resolveOne(db: Database, symbol: string): Node {
	const nodes = resolveSymbol(db, symbol);
	if (nodes.length === 0) {
		db.close();
		console.error(`Unknown symbol: ${symbol}`);
		process.exit(1);
	}
	if (nodes.length > 1) {
		db.close();
		console.error("Ambiguous symbol. Matches:");
		for (const n of nodes) {
			console.error(`  ${n.id}`);
		}
		process.exit(1);
	}
	const node = nodes[0];
	if (!node) {
		db.close();
		console.error("Symbol resolution failed");
		process.exit(1);
	}
	return node;
}

/** Builds a flow tree by recursively following call edges from a root node. */
function buildFlowTree(
	db: Database,
	node: Node,
	boundaryMap: Map<string, string>,
	visited: Set<string>,
): FlowTreeNode {
	visited.add(node.id);
	const boundary = boundaryMap.get(node.id);
	const callees = getCallees(db, node.id);

	// Check for emits tags
	const emitRows = db
		.query("SELECT value FROM tags WHERE node_id = ? AND kind = 'emits'")
		.all(node.id) as { value: string }[];
	const emits = emitRows.length > 0 ? emitRows.map((r) => r.value).join(", ") : undefined;

	const children: FlowTreeNode[] = [];
	for (const callee of callees) {
		if (!visited.has(callee.id)) {
			children.push(buildFlowTree(db, callee, boundaryMap, visited));
		}
	}

	return { node, boundary, emits, children };
}

program.parse();
