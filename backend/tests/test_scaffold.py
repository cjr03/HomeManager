from sqlalchemy import text

from app.db import get_db


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_unknown_api_route_is_404(client):
    assert client.get("/api/nope").status_code == 404


# The two tests below run in order: the first writes, the second proves it was rolled back.
def test_rollback_isolation_write(db):
    db.execute(text("CREATE TABLE IF NOT EXISTS _iso (n int)"))
    db.execute(text("INSERT INTO _iso VALUES (1)"))
    db.commit()  # commit only releases the savepoint; outer transaction still rolls back
    assert db.execute(text("SELECT count(*) FROM _iso")).scalar() == 1


def test_rollback_isolation_clean(db):
    exists = db.execute(text("SELECT to_regclass('_iso')")).scalar()
    assert exists is None


def test_get_db_yields_and_closes_session():
    gen = get_db()
    session = next(gen)
    assert session.execute(text("SELECT 1")).scalar() == 1
    gen.close()
