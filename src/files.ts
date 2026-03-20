import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Checks if a file or directory name matches any exclusion pattern.
 *
 * @param name - File or directory name to check
 * @param excludePatterns - Patterns to exclude
 * @returns True if the name matches any pattern
 */
function isExcluded(name: string, excludePatterns: readonly string[]): boolean {
	return excludePatterns.some((pattern) => name.includes(pattern));
}

/**
 * Recursively discovers files matching given extensions, excluding directories by pattern.
 *
 * @param root - Root directory to search
 * @param extensions - File extensions to include (e.g., [".ts", ".tsx"])
 * @param exclude - Directory name patterns to skip
 * @returns Array of absolute file paths
 */
function discoverFiles(
	root: string,
	extensions: readonly string[],
	exclude: readonly string[],
): readonly string[] {
	const files: string[] = [];
	function walk(dir: string): void {
		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!isExcluded(entry.name, exclude)) walk(fullPath);
			} else if (extensions.some((ext) => entry.name.endsWith(ext))) {
				files.push(fullPath);
			}
		}
	}
	walk(root);
	return files;
}

export { discoverFiles, isExcluded };
