import stripe

# @lattice:boundary stripe
def charge(amount: float, token: str) -> dict:
    payload = build_stripe_payload(amount, token)
    return stripe.charges.create(**payload)

def build_stripe_payload(amount, token):
    return {"amount": int(amount * 100), "source": token}
