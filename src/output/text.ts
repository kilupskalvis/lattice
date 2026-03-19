import type { BoundaryEntry, EventConnection, FlowEntry } from "../graph/queries.ts";
import type { Node } from "../types/graph.ts";

/** Formats a node reference as "name (file:line)". */
function nodeRef(node: Node): string {
	return `${node.name} (${node.file}:${node.lineStart})`;
}

/** Tree node for flow visualization. */
type FlowTreeNode = {
	readonly node: Node;
	readonly boundary: string | undefined;
	readonly emits: string | undefined;
	readonly children: readonly FlowTreeNode[];
};

/** Context data for the `lattice context` command. */
type ContextData = {
	readonly node: Node;
	readonly flows: readonly string[];
	readonly callers: readonly Node[];
	readonly callees: readonly Node[];
	readonly boundary: string | undefined;
};

/** Impact data for the `lattice impact` command. */
type ImpactData = {
	readonly directCallers: readonly Node[];
	readonly transitiveCallers: readonly Node[];
	readonly affectedFlows: readonly string[];
	readonly affectedTests: readonly Node[];
};

/**
 * Formats the overview output showing all flows, boundaries, and events.
 *
 * @param flows - All flow entry points
 * @param boundaries - All boundary-tagged nodes
 * @param events - All event connections
 * @returns Compact text output
 */
function formatOverview(
	flows: readonly FlowEntry[],
	boundaries: readonly BoundaryEntry[],
	events: readonly EventConnection[],
): string {
	const lines: string[] = [];

	lines.push("Flows:");
	for (const flow of flows) {
		const route = flow.node.metadata?.route;
		const routeStr = route ? `→ ${route} ` : "→ ";
		lines.push(`  ${flow.value.padEnd(20)} ${routeStr}(${flow.node.file}:${flow.node.lineStart})`);
	}

	lines.push("");
	lines.push("Boundaries:");
	const boundaryGroups = groupBy(boundaries, (b) => b.value);
	for (const [name, entries] of boundaryGroups) {
		const files = new Set(entries.map((e) => e.node.file));
		lines.push(
			`  ${name.padEnd(20)} → ${entries.length} function${entries.length !== 1 ? "s" : ""} across ${files.size} file${files.size !== 1 ? "s" : ""}`,
		);
	}

	lines.push("");
	lines.push("Events:");
	for (const event of events) {
		lines.push(
			`  ${event.eventName.padEnd(20)} → emitted by ${event.emitterName}, handled by ${event.handlerName}`,
		);
	}

	return lines.join("\n");
}

/**
 * Formats a flow call tree with boundary markers and event annotations.
 *
 * @param tree - Root node of the flow tree
 * @returns Indented tree output
 */
function formatFlowTree(tree: FlowTreeNode): string {
	const lines: string[] = [];
	formatTreeNode(tree, lines, 0);
	return lines.join("\n");
}

/** Recursively formats a tree node with indentation. */
function formatTreeNode(node: FlowTreeNode, lines: string[], depth: number): void {
	const indent = depth === 0 ? "" : `${"  ".repeat(depth)}→ `;
	const boundary = node.boundary ? ` [${node.boundary}]` : "";
	const emits = node.emits ? ` emits ${node.emits}` : "";
	lines.push(`${indent}${nodeRef(node.node)}${boundary}${emits}`);

	for (const child of node.children) {
		formatTreeNode(child, lines, depth + 1);
	}
}

/**
 * Formats a symbol's context: signature, flows, callers, callees, boundary.
 *
 * @param data - Context data for the symbol
 * @returns Compact text output
 */
function formatContext(data: ContextData): string {
	const lines: string[] = [];

	lines.push(`${data.node.name} (${data.node.file}:${data.node.lineStart})`);

	if (data.node.signature) {
		lines.push(`  signature: ${data.node.signature}`);
	}

	if (data.flows.length > 0) {
		lines.push(`  flows: ${data.flows.join(", ")} (derived)`);
	}

	if (data.callers.length > 0) {
		lines.push("");
		lines.push("  callers:");
		for (const caller of data.callers) {
			lines.push(`    ← ${nodeRef(caller)}`);
		}
	}

	if (data.callees.length > 0) {
		lines.push("");
		lines.push("  callees:");
		for (const callee of data.callees) {
			lines.push(`    → ${nodeRef(callee)}`);
		}
	}

	if (data.boundary) {
		lines.push("");
		lines.push(`  boundary: ${data.boundary}`);
	}

	return lines.join("\n");
}

/**
 * Formats impact analysis: direct callers, transitive callers, affected flows, tests.
 *
 * @param data - Impact analysis data
 * @returns Compact text output
 */
function formatImpact(data: ImpactData): string {
	const lines: string[] = [];

	lines.push("Direct callers:");
	for (const caller of data.directCallers) {
		lines.push(`  ← ${nodeRef(caller)}`);
	}

	if (data.transitiveCallers.length > 0) {
		lines.push("");
		lines.push("Transitive callers:");
		for (const caller of data.transitiveCallers) {
			lines.push(`  ← ${nodeRef(caller)}`);
		}
	}

	if (data.affectedFlows.length > 0) {
		lines.push("");
		lines.push(`Affected flows: ${data.affectedFlows.join(", ")}`);
	}

	if (data.affectedTests.length > 0) {
		lines.push("");
		lines.push("Tests:");
		for (const test of data.affectedTests) {
			lines.push(`  ${test.id}`);
		}
	}

	return lines.join("\n");
}

/**
 * Formats a list of callers.
 *
 * @param callers - Nodes that call the target
 * @returns Compact text output
 */
function formatCallers(callers: readonly Node[]): string {
	return callers.map((c) => `← ${nodeRef(c)}`).join("\n");
}

/**
 * Formats a list of callees.
 *
 * @param callees - Nodes that the target calls
 * @returns Compact text output
 */
function formatCallees(callees: readonly Node[]): string {
	return callees.map((c) => `→ ${nodeRef(c)}`).join("\n");
}

/**
 * Formats boundaries grouped by system name.
 *
 * @param entries - All boundary entries
 * @returns Compact text output
 */
function formatBoundaries(entries: readonly BoundaryEntry[]): string {
	const lines: string[] = [];
	const groups = groupBy(entries, (e) => e.value);

	for (const [name, group] of groups) {
		lines.push(`${name}:`);
		for (const entry of group) {
			lines.push(`  ${nodeRef(entry.node)}`);
		}
	}

	return lines.join("\n");
}

/**
 * Formats event connections.
 *
 * @param events - All event connections
 * @returns Compact text output
 */
function formatEvents(events: readonly EventConnection[]): string {
	const lines: string[] = [];
	for (const event of events) {
		lines.push(
			`${event.eventName} → emitted by ${event.emitterName}, handled by ${event.handlerName}`,
		);
	}
	return lines.join("\n");
}

/** Groups an array by a key function. */
function groupBy<T>(items: readonly T[], keyFn: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const key = keyFn(item);
		const existing = groups.get(key);
		if (existing) {
			existing.push(item);
		} else {
			groups.set(key, [item]);
		}
	}
	return groups;
}

export {
	type ContextData,
	type FlowTreeNode,
	formatBoundaries,
	formatCallees,
	formatCallers,
	formatContext,
	formatEvents,
	formatFlowTree,
	formatImpact,
	formatOverview,
	type ImpactData,
};
