import os

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg:///homemanager_test"
)

import itertools  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.auth import User, create_token, hash_password  # noqa: E402
from app.db import Base, engine, get_db  # noqa: E402
from app.main import app  # noqa: E402

PASSWORD = "Correct-horse1"
_seq = itertools.count()


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


@pytest.fixture
def db():
    with engine.connect() as conn:
        trans = conn.begin()
        session = Session(bind=conn, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            session.close()
            trans.rollback()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def make_user(db):
    """make_user(username=None, password=PASSWORD, email=..., **columns) -> User."""

    def make(username: str | None = None, password: str = PASSWORD, **fields) -> User:
        username = username or f"user{next(_seq)}"
        fields.setdefault("email", f"{username.lower()}@example.com")
        user = User(username=username, password_hash=hash_password(password), **fields)
        db.add(user)
        db.flush()
        return user

    return make


@pytest.fixture
def client_for(client):
    """client_for(user) -> a TestClient authenticated as that user (same test DB)."""

    def make(user: User) -> TestClient:
        c = TestClient(app)
        c.cookies.set("session", create_token(user.id), domain="testserver.local")
        return c

    return make


@pytest.fixture
def auth_client(make_user, client_for):
    """A TestClient logged in as a fresh user, available as `auth_client.user`."""
    user = make_user()
    c = client_for(user)
    c.user = user
    return c
