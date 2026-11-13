import os

from sqlalchemy.engine import make_url

# Test modules can import the database models during collection.
url = os.getenv("ATT_TEST_DATABASE_URL")
if url:
    database = make_url(url).database
    if not database or not database.endswith("_test"):
        raise ValueError("ATT_TEST_DATABASE_URL must name a disposable database ending in _test")
    os.environ["DATABASE_URL"] = url
