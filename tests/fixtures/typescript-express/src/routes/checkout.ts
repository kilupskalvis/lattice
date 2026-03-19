import { Router } from "express";
import { createOrder } from "../services/order";

const router = Router();

// @lattice:flow checkout
router.post("/api/checkout", async (req, res) => {
	const order = await createOrder(req.body);
	res.json(order);
});

export { router };
