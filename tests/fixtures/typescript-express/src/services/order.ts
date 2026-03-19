import { saveOrder } from "../db/orders";
import { charge } from "../gateways/payment";

export async function createOrder(data: unknown): Promise<Order> {
	const result = await charge(data);
	await saveOrder(data, result);
	return result;
}

interface Order {
	id: string;
	amount: number;
}
