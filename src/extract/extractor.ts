import type { ExtractionResult } from "../types/graph.ts";

/**
 * Language-specific extractor that produces nodes, edges, and tags from source files.
 * Each supported language implements this type.
 */
type Extractor = {
	readonly language: string;
	readonly fileExtensions: readonly string[];
	readonly extract: (filePath: string, source: string) => Promise<ExtractionResult>;
};

export type { Extractor };
