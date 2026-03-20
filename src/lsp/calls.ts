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
			// Skip type declarations — not runtime calls
			if (isTypeDeclaration(uri)) continue;

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
	const decoded = decodeURIComponent(uri);
	const nodeModulesIdx = decoded.indexOf("/node_modules/");
	if (nodeModulesIdx === -1) return undefined;
	const afterNm = decoded.slice(nodeModulesIdx + "/node_modules/".length);
	if (afterNm.startsWith("@")) {
		const parts = afterNm.split("/");
		return `${parts[0]}/${parts[1]}`;
	}
	return afterNm.split("/")[0];
}

/**
 * Checks if a URI points to a type-only package (not a runtime dependency).
 * Type definition packages (@types/*, typescript, bun-types) are filtered out.
 * Actual library .d.ts stubs (e.g., stripe/index.d.ts) are kept — they represent runtime deps.
 */
function isTypeDeclaration(uri: string): boolean {
	if (uri.includes("/node_modules/@types/")) return true;
	if (uri.includes("/node_modules/%40types/")) return true;
	if (uri.includes("/node_modules/typescript/")) return true;
	if (uri.includes("/node_modules/bun-types/")) return true;
	return false;
}

export { type CallConversionResult, extractPackageName, isTypeDeclaration, outgoingCallsToEdges };
