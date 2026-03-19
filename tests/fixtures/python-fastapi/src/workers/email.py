# @lattice:handles order.created
def send_confirmation(event):
    sendgrid.send(event.order_id)
