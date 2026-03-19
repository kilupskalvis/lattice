from src.gateways.payment import charge
from src.db.orders import save_order

def create_order(req):
    result = charge(req.amount, req.token)
    save_order(req, result)
    emit_order_created(req.order_id)

# @lattice:emits order.created
def emit_order_created(order_id):
    queue.publish("order.created", {"order_id": order_id})
