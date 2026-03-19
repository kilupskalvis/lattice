def emit_order_created(order_id):
    queue.publish("order.created", {"order_id": order_id})
