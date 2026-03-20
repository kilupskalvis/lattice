import type { Edge, ExternalCall } from "../types/graph.ts";
import type { CallHierarchyOutgoingCall } from "./types.ts";

/** Result of converting outgoing calls to edges. */
type CallConversionResult = {
	readonly edges: readonly Edge[];
	readonly externalCalls: readonly ExternalCall[];
};

/**
 * Converts LSP CallHierarchyOutgoingCall responses into Lattice Edges.
 * Calls to symbols outside the project root are collected as external calls.
 *
 * @param sourceId - The Lattice node ID of the calling function
 * @param calls - Outgoing calls from LSP
 * @param projectRoot - Absolute path to the project root
 * @returns Internal edges and external call records
 */
function outgoingCallsToEdges(
	sourceId: string,
	calls: readonly CallHierarchyOutgoingCall[],
	projectRoot: string,
): CallConversionResult {
	const edges: Edge[] = [];
	const externalCalls: ExternalCall[] = [];
	const projectFilePrefix = `file://${projectRoot}/`;

	for (const call of calls) {
		const uri = call.to.uri;

		if (!uri.startsWith(projectFilePrefix) || uri.includes("/node_modules/")) {
			const pkg = extractPackageName(uri);
			if (pkg) {
				externalCalls.push({ nodeId: sourceId, package: pkg, symbol: call.to.name });
			}
			continue;
		}

		const relativePath = uri.slice(projectFilePrefix.length);
		const targetId = `${relativePath}::${call.to.name}`;
		edges.push({ sourceId, targetId, kind: "calls" });
	}

	return { edges, externalCalls };
}

/**
 * Extracts the package name from a node_modules URI.
 * Handles scoped packages (@scope/package).
 */
function extractPackageName(uri: string): string | undefined {
	const nodeModulesIdx = uri.indexOf("/node_modules/");
	if (nodeModulesIdx === -1) return undefined;
	const afterNm = uri.slice(nodeModulesIdx + "/node_modules/".length);
	if (afterNm.startsWith("@")) {
		const parts = afterNm.split("/");
		return `${parts[0]}/${parts[1]}`;
	}
	return afterNm.split("/")[0];
}

export { type CallConversionResult, extractPackageName, outgoingCallsToEdges };
