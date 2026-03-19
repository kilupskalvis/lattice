@app.post("/api/checkout")
def handle_checkout(req):
    return create_order(req)
