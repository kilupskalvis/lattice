/** Valid kinds for graph nodes. */
const NODE_KINDS = ["function", "method", "class", "type", "module"] as const;
type NodeKind = (typeof NODE_KINDS)[number];

/** Valid kinds for graph edges. */
const EDGE_KINDS = ["calls", "imports", "implements", "contains", "event"] as const;
type EdgeKind = (typeof EDGE_KINDS)[number];

/** Valid kinds for lattice tags. */
const TAG_KINDS = ["flow", "boundary", "emits", "handles"] as const;
type TagKind = (typeof TAG_KINDS)[number];

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
};

/** A lattice annotation on a node. */
type Tag = {
	readonly nodeId: string;
	readonly kind: TagKind;
	readonly value: string;
};

/** A call from a project function to an external package. */
type ExternalCall = {
	readonly nodeId: string;
	readonly package: string;
	readonly symbol: string;
};

export {
	EDGE_KINDS,
	type Edge,
	type EdgeKind,
	type ExternalCall,
	NODE_KINDS,
	type Node,
	type NodeKind,
	TAG_KINDS,
	type Tag,
	type TagKind,
};
