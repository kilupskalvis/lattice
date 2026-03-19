from src.services.order import create_order

# @lattice:flow checkout
@app.post("/api/checkout")
def handle_checkout(req):
    order = create_order(req)
    return order
