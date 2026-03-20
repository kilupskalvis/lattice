import type { Node, Tag, TagKind } from "../types/graph.ts";
import { TAG_KINDS } from "../types/graph.ts";

const TAG_PATTERN = /^@lattice:(\S+)\s+(.+)/;
const NAME_PATTERN = /^[a-z][a-z0-9._-]*$/;

const COMMENT_PREFIXES: Record<string, RegExp> = {
	typescript: /^\s*(?:\/\/|\/\*\*?|\*)\s*/,
	python: /^\s*(?:#|""")\s*/,
};
const DEFAULT_COMMENT_PREFIX = /^\s*(?:\/\/|#|--|\/\*\*?|\*)\s*/;

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
 * @param language - Language identifier for comment prefix detection
 * @returns Parsed tags and validation errors
 */
function scanTags(source: string, nodes: readonly Node[], language?: string): TagScanResult {
	const lines = source.split("\n");
	const tags: Tag[] = [];
	const errors: string[] = [];
	const commentPrefix =
		(language ? COMMENT_PREFIXES[language] : undefined) ?? DEFAULT_COMMENT_PREFIX;

	const candidateNodes = [...nodes]
		.filter((n) => n.kind === "function" || n.kind === "method" || n.kind === "class")
		.sort((a, b) => a.lineStart - b.lineStart);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const tagLine = i + 1;

		// Only process lines that start with a comment prefix for this language
		if (!commentPrefix.test(line)) continue;

		// Skip tags that are inside a function body and point to the SAME function
		// (these are @lattice: mentions in string literals, not real tags).
		// Tags between functions (e.g., above a decorated function whose predecessor's
		// range overlaps) are fine — the target will be a different, later function.
		const containingNode = candidateNodes.find(
			(n) => tagLine > n.lineStart && tagLine <= n.lineEnd,
		);
		// If the tag is inside a function and the next function IS that same function, skip it
		const nextNode = candidateNodes.find((n) => n.lineStart >= tagLine);
		if (containingNode && nextNode && containingNode.id === nextNode.id) continue;

		const stripped = line.replace(commentPrefix, "");
		const match = stripped.match(TAG_PATTERN);
		if (!match) continue;

		const kind = match[1] as string;
		const rawValue = match[2] as string;

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
				errors.push(`Line ${tagLine}: invalid tag name '${value}' — must be lowercase kebab-case`);
				continue;
			}

			const targetNode = candidateNodes.find((n) => n.lineStart >= tagLine);
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
