/** Valid kinds for graph nodes. */
const NODE_KINDS = ["function", "method", "class", "type", "module"] as const;
type NodeKind = (typeof NODE_KINDS)[number];

/** Valid kinds for graph edges. */
const EDGE_KINDS = ["calls", "imports", "implements", "contains", "event"] as const;
type EdgeKind = (typeof EDGE_KINDS)[number];

/** Valid kinds for lattice tags. */
const TAG_KINDS = ["flow", "boundary", "emits", "handles"] as const;
type TagKind = (typeof TAG_KINDS)[number];

/** Certainty level of an edge relationship. */
const CERTAINTY_LEVELS = ["certain", "uncertain"] as const;
type Certainty = (typeof CERTAINTY_LEVELS)[number];

/** Reasons an extractor may fail to resolve a reference. */
const UNRESOLVED_REASONS = [
	"dynamic_dispatch",
	"unknown_module",
	"computed_property",
	"untyped_call",
] as const;
type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

/** A symbol in the codebase (function, class, method, type, module). */
type Node = {
	readonly id: string;
	readonly kind: NodeKind;
	readonly name: string;
	readonly file: string;
	readonly lineStart: number;
	readonly lineEnd: number;
	readonly language: string;
	readonly signature: string | undefined;
	readonly isTest: boolean;
	readonly metadata: Record<string, string> | undefined;
};

/** A directed relationship between two nodes. */
type Edge = {
	readonly sourceId: string;
	readonly targetId: string;
	readonly kind: EdgeKind;
	readonly certainty: Certainty;
};

/** A lattice annotation on a node. */
type Tag = {
	readonly nodeId: string;
	readonly kind: TagKind;
	readonly value: string;
};

/** A reference that could not be resolved during extraction. */
type UnresolvedReference = {
	readonly file: string;
	readonly line: number;
	readonly expression: string;
	readonly reason: UnresolvedReason;
};

/** The complete output of extracting a single file. */
type ExtractionResult = {
	readonly nodes: readonly Node[];
	readonly edges: readonly Edge[];
	readonly tags: readonly Tag[];
	readonly unresolved: readonly UnresolvedReference[];
};

export {
	CERTAINTY_LEVELS,
	type Certainty,
	EDGE_KINDS,
	type Edge,
	type EdgeKind,
	type ExtractionResult,
	NODE_KINDS,
	type Node,
	type NodeKind,
	TAG_KINDS,
	type Tag,
	type TagKind,
	UNRESOLVED_REASONS,
	type UnresolvedReason,
	type UnresolvedReference,
};
