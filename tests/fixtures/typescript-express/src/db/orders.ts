// @lattice:boundary postgres
export async function saveOrder(_data: unknown, _chargeResult: unknown): Promise<void> {
	await db.query("INSERT INTO orders ...");
}
