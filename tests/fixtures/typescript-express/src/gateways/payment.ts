import Stripe from "stripe";

const stripe = new Stripe("sk_test");

// @lattice:boundary stripe
export async function charge(data: unknown): Promise<ChargeResult> {
	const payload = buildPayload(data);
	return stripe.charges.create(payload);
}

function buildPayload(_data: unknown): Stripe.ChargeCreateParams {
	return { amount: 100, currency: "usd" };
}

interface ChargeResult {
	id: string;
	status: string;
}
