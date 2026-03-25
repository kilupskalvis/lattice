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
 * @param language - Language identifier for external call detection
 * @returns Internal edges and external call records
 */
function outgoingCallsToEdges(
	sourceId: string,
	calls: readonly CallHierarchyOutgoingCall[],
	projectRoot: string,
	language: string,
): CallConversionResult {
	const edges: Edge[] = [];
	const externalCalls: ExternalCall[] = [];
	const projectFilePrefix = `file://${projectRoot}/`;

	for (const call of calls) {
		const uri = call.to.uri;

		const isExternal =
			!uri.startsWith(projectFilePrefix) ||
			uri.includes("/node_modules/") ||
			uri.includes("/pkg/mod/");

		if (isExternal) {
			if (language !== "go" && isTypeDeclaration(uri)) continue;

			const pkg = language === "go" ? extractGoModuleName(uri) : extractPackageName(uri);
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
 * Extracts the Go module name from a module cache or stdlib URI.
 * Module cache paths contain /pkg/mod/ with @version.
 * Stdlib paths contain /go/src/ without @version.
 */
function extractGoModuleName(uri: string): string | undefined {
	const decoded = decodeURIComponent(uri);

	// Go module cache: contains /pkg/mod/ with @version
	const pkgModIdx = decoded.indexOf("/pkg/mod/");
	if (pkgModIdx !== -1) {
		const afterMod = decoded.slice(pkgModIdx + "/pkg/mod/".length);
		const atIdx = afterMod.indexOf("@");
		if (atIdx !== -1) {
			return afterMod.slice(0, atIdx);
		}
	}

	// Go stdlib: contains /go/src/ without @version
	const goSrcMatch = decoded.match(/\/go\/src\/(.+?)\/[^/]+$/);
	if (goSrcMatch && !decoded.includes("@")) {
		return goSrcMatch[1];
	}

	return undefined;
}

/**
 * Checks if a URI points to a type-only package (not a runtime dependency).
 * Type definition packages (@types/*, typescript, bun-types) are filtered out.
 * Actual library .d.ts stubs (e.g., stripe/index.d.ts) are kept — they represent runtime deps.
 */
function isTypeDeclaration(uri: string): boolean {
	// TypeScript type-only packages
	if (uri.includes("/node_modules/@types/")) return true;
	if (uri.includes("/node_modules/%40types/")) return true;
	if (uri.includes("/node_modules/typescript/")) return true;
	if (uri.includes("/node_modules/bun-types/")) return true;
	// Python type stubs
	if (uri.includes("/typeshed/")) return true;
	if (uri.includes("/typestubs/")) return true;
	if (uri.includes("-stubs/")) return true;
	return false;
}

export {
	type CallConversionResult,
	extractGoModuleName,
	extractPackageName,
	isTypeDeclaration,
	outgoingCallsToEdges,
};
