import type { BoundaryEntry, EventConnection, FlowEntry } from "../graph/queries.ts";
import type { ContextData } from "./text.ts";

/**
 * Formats the overview as JSON.
 *
 * @param flows - All flow entry points
 * @param boundaries - All boundary-tagged nodes
 * @param events - All event connections
 * @returns JSON string
 */
function formatOverviewJson(
	flows: readonly FlowEntry[],
	boundaries: readonly BoundaryEntry[],
	events: readonly EventConnection[],
): string {
	return JSON.stringify(
		{
			flows: flows.map((f) => ({
				name: f.value,
				entryPoint: f.node.name,
				file: f.node.file,
				line: f.node.lineStart,
				route: f.node.metadata?.route,
			})),
			boundaries: boundaries.map((b) => ({
				system: b.value,
				function: b.node.name,
				file: b.node.file,
				line: b.node.lineStart,
			})),
			events: events.map((e) => ({
				event: e.eventName,
				emitter: e.emitterName,
				emitterFile: e.emitterFile,
				handler: e.handlerName,
				handlerFile: e.handlerFile,
			})),
		},
		undefined,
		2,
	);
}

/**
 * Formats a symbol's context as JSON.
 *
 * @param data - Context data for the symbol
 * @returns JSON string
 */
function formatContextJson(data: ContextData): string {
	return JSON.stringify(
		{
			id: data.node.id,
			name: data.node.name,
			file: data.node.file,
			line: data.node.lineStart,
			signature: data.node.signature,
			flows: data.flows,
			callers: data.callers.map((c) => ({
				id: c.id,
				name: c.name,
				file: c.file,
				line: c.lineStart,
			})),
			callees: data.callees.map((c) => ({
				id: c.id,
				name: c.name,
				file: c.file,
				line: c.lineStart,
			})),
			boundary: data.boundary,
		},
		undefined,
		2,
	);
}

export { formatContextJson, formatOverviewJson };
