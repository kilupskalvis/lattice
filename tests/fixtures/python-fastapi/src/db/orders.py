import psycopg2

# @lattice:boundary postgres
def save_order(req, charge_result):
    db.execute("INSERT INTO orders ...")
