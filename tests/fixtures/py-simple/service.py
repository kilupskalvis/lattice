from .db import save_order


# @lattice:flow process-order
def process_order(order_id: str) -> None:
    validated = validate(order_id)
    save_order(validated)


def validate(order_id: str) -> str:
    return order_id.strip()
