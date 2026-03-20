import type { Node, Tag, TagKind } from "../types/graph.ts";
import { TAG_KINDS } from "../types/graph.ts";

const TAG_PATTERN = /@lattice:(\S+)\s+(.+)/;
const COMMENT_PREFIX = /^\s*(?:\/\/|#|--|\/\*\*?|\*)\s*/;
const NAME_PATTERN = /^[a-z][a-z0-9._-]*$/;

/** Result of scanning a file for @lattice: tags. */
type TagScanResult = {
	readonly tags: readonly Tag[];
	readonly errors: readonly string[];
};

/**
 * Scans source code for @lattice: tags and associates them with LSP-provided symbols.
 * Validates tag syntax and names. Returns tags and any validation errors.
 *
 * @param source - File source code
 * @param nodes - Nodes from LSP documentSymbol for this file
 * @returns Parsed tags and validation errors
 */
function scanTags(source: string, nodes: readonly Node[]): TagScanResult {
	const lines = source.split("\n");
	const tags: Tag[] = [];
	const errors: string[] = [];

	const sortedNodes = [...nodes]
		.filter((n) => n.kind === "function" || n.kind === "method" || n.kind === "class")
		.sort((a, b) => a.lineStart - b.lineStart);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;

		const stripped = line.replace(COMMENT_PREFIX, "");
		const match = stripped.match(TAG_PATTERN);
		if (!match) continue;

		const kind = match[1] as string;
		const rawValue = match[2] as string;
		const tagLine = i + 1;

		if (!TAG_KINDS.includes(kind as TagKind)) {
			errors.push(`Line ${tagLine}: unknown tag kind '${kind}'`);
			continue;
		}

		const values = rawValue
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);

		for (const value of values) {
			if (!NAME_PATTERN.test(value)) {
				errors.push(
					`Line ${tagLine}: invalid tag name '${value}' — must be lowercase kebab-case`,
				);
				continue;
			}

			const targetNode = sortedNodes.find((n) => n.lineStart >= tagLine);
			if (!targetNode) {
				errors.push(`Line ${tagLine}: @lattice:${kind} ${value} has no function below it`);
				continue;
			}

			tags.push({ nodeId: targetNode.id, kind: kind as TagKind, value });
		}
	}

	return { tags, errors };
}

export { scanTags, type TagScanResult };
