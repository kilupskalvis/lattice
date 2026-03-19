import type { TagKind } from "../types/graph.ts";
import { err, ok, type Result } from "../types/result.ts";

/** A parsed tag before it's associated with a specific node ID. */
type ParsedTag = {
	readonly kind: TagKind;
	readonly value: string;
};

const VALID_TAG_KINDS = new Set<string>(["flow", "boundary", "emits", "handles"]);

/** Matches @lattice:<kind> <value> after comment prefix has been stripped. */
const TAG_PATTERN = /@lattice:(\w+)\s+(.+)/;

/** Valid tag name: lowercase letters, numbers, hyphens, dots. Must start with a letter or number. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9\-.]*$/;

/** Strips common comment prefixes from a line. */
function stripCommentPrefix(line: string): string {
	const trimmed = line.trim();
	// Try each prefix in order
	if (trimmed.startsWith("//")) return trimmed.slice(2).trim();
	if (trimmed.startsWith("#")) return trimmed.slice(1).trim();
	if (trimmed.startsWith("--")) return trimmed.slice(2).trim();
	if (trimmed.startsWith("/*"))
		return trimmed
			.slice(2)
			.replace(/\*\/\s*$/, "")
			.trim();
	return trimmed;
}

/**
 * Parses lattice tags from a comment block.
 * Recognizes any comment style: #, //, /∗ ∗/, --.
 * Returns parsed tags or an error for invalid tag name syntax.
 *
 * @param commentBlock - Raw comment text, possibly multiline
 * @returns Parsed tags or an error message
 */
function parseTags(commentBlock: string): Result<readonly ParsedTag[], string> {
	if (!commentBlock.trim()) return ok([]);

	const tags: ParsedTag[] = [];
	const lines = commentBlock.split("\n");

	for (const line of lines) {
		const stripped = stripCommentPrefix(line);
		const match = TAG_PATTERN.exec(stripped);
		if (!match) continue;

		const kindStr = match[1];
		const valuesStr = match[2];
		if (!kindStr || !valuesStr) continue;

		if (!VALID_TAG_KINDS.has(kindStr)) continue;

		const kind = kindStr as TagKind;
		const rawValues = valuesStr.split(",").map((v) => v.trim());

		for (const value of rawValues) {
			if (!value) continue;

			if (!NAME_PATTERN.test(value)) {
				return err(
					`Invalid tag name "${value}": must be kebab-case (lowercase letters, numbers, hyphens, dots)`,
				);
			}

			tags.push({ kind, value });
		}
	}

	return ok(tags);
}

export { type ParsedTag, parseTags };
