import { save } from "./db";

// @lattice:flow process-order
export function processOrder(id: string): void {
	const result = validate(id);
	save(result);
}

function validate(id: string): string {
	return id.trim();
}
