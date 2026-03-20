/** JSON-RPC message envelope. */
type JsonRpcMessage = {
	readonly jsonrpc: "2.0";
	readonly id?: number;
	readonly method?: string;
	readonly params?: unknown;
	readonly result?: unknown;
	readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
};

/** Position in a text document (0-based). */
type Position = {
	readonly line: number;
	readonly character: number;
};

/** Range in a text document. */
type Range = {
	readonly start: Position;
	readonly end: Position;
};

/** LSP SymbolKind values (subset Lattice uses). */
const SymbolKind = {
	Function: 12,
	Method: 6,
	Class: 5,
	Interface: 11,
	Constructor: 9,
	Variable: 13,
	Property: 7,
} as const;

/** A symbol in a document, returned by textDocument/documentSymbol. */
type DocumentSymbol = {
	readonly name: string;
	readonly kind: number;
	readonly range: Range;
	readonly selectionRange: Range;
	readonly children?: readonly DocumentSymbol[];
};

/** A call hierarchy item, returned by textDocument/prepareCallHierarchy. */
type CallHierarchyItem = {
	readonly name: string;
	readonly kind: number;
	readonly uri: string;
	readonly range: Range;
	readonly selectionRange: Range;
};

/** An outgoing call, returned by callHierarchy/outgoingCalls. */
type CallHierarchyOutgoingCall = {
	readonly to: CallHierarchyItem;
	readonly fromRanges: readonly Range[];
};

/** A location in a document, returned by textDocument/references. */
type Location = {
	readonly uri: string;
	readonly range: Range;
};

export {
	type CallHierarchyItem,
	type CallHierarchyOutgoingCall,
	type DocumentSymbol,
	type JsonRpcMessage,
	type Location,
	type Position,
	type Range,
	SymbolKind,
};
