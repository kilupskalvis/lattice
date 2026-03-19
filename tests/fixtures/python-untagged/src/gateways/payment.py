import stripe

def charge(amount, token):
    return stripe.charges.create(amount=amount, source=token)
