from datetime import date

import pytest

from app.accounts import Link
from app.calendar import occurrences

D = date.fromisoformat


# ---- unit: occurrences ----

def test_none_is_a_single_day():
    assert occurrences(D("2026-03-10"), "none", None, D("2026-03-01"), D("2026-03-31")) == [D("2026-03-10")]
    assert occurrences(D("2026-03-10"), "none", None, D("2026-04-01"), D("2026-04-30")) == []
    assert occurrences(D("2026-03-10"), "none", None, D("2026-03-10"), D("2026-03-10")) == [D("2026-03-10")]


def test_daily():
    assert occurrences(D("2026-03-29"), "daily", None, D("2026-03-01"), D("2026-04-02")) == [
        D("2026-03-29"), D("2026-03-30"), D("2026-03-31"), D("2026-04-01"), D("2026-04-02"),
    ]


def test_daily_started_long_before_range():
    assert occurrences(D("2020-01-01"), "daily", None, D("2026-03-01"), D("2026-03-03")) == [
        D("2026-03-01"), D("2026-03-02"), D("2026-03-03"),
    ]


def test_weekly_keeps_weekday():
    out = occurrences(D("2026-02-24"), "weekly", None, D("2026-03-01"), D("2026-03-31"))
    assert out == [D("2026-03-03"), D("2026-03-10"), D("2026-03-17"), D("2026-03-24"), D("2026-03-31")]


def test_biweekly_counts_from_start():
    out = occurrences(D("2026-02-24"), "biweekly", None, D("2026-03-01"), D("2026-03-31"))
    assert out == [D("2026-03-10"), D("2026-03-24")]


def test_monthly_clamps_to_month_end_and_recovers():
    out = occurrences(D("2026-01-31"), "monthly", None, D("2026-01-01"), D("2026-05-31"))
    assert out == [D("2026-01-31"), D("2026-02-28"), D("2026-03-31"), D("2026-04-30"), D("2026-05-31")]


def test_monthly_leap_year():
    out = occurrences(D("2028-01-30"), "monthly", None, D("2028-02-01"), D("2028-03-31"))
    assert out == [D("2028-02-29"), D("2028-03-30")]


def test_monthly_across_year_boundary():
    out = occurrences(D("2025-11-15"), "monthly", None, D("2026-01-01"), D("2026-02-28"))
    assert out == [D("2026-01-15"), D("2026-02-15")]


def test_daily_through_leap_day():
    out = occurrences(D("2028-02-27"), "daily", None, D("2028-02-28"), D("2028-03-01"))
    assert out == [D("2028-02-28"), D("2028-02-29"), D("2028-03-01")]


def test_end_date_is_inclusive_and_stops_series():
    out = occurrences(D("2026-03-01"), "weekly", D("2026-03-15"), D("2026-03-01"), D("2026-03-31"))
    assert out == [D("2026-03-01"), D("2026-03-08"), D("2026-03-15")]
    assert occurrences(D("2026-01-31"), "monthly", D("2026-02-27"), D("2026-02-01"), D("2026-02-28")) == []


def test_range_before_start_is_empty():
    for rec in ("none", "daily", "weekly", "biweekly", "monthly"):
        assert occurrences(D("2026-06-01"), rec, None, D("2026-05-01"), D("2026-05-31")) == []


def test_end_before_range_is_empty():
    assert occurrences(D("2026-01-01"), "daily", D("2026-02-01"), D("2026-03-01"), D("2026-03-31")) == []


# ---- API helpers ----

def link(db, a, b, status="accepted"):
    db.add(Link(requester_id=a.id, addressee_id=b.id, status=status))
    db.flush()


def event(c, **kw):
    body = {"title": "Dentist", "date": "2026-03-10", "start_time": "09:30", "notes": "", "shared": False} | kw
    return c.post("/api/events", json=body)


def chore(c, assignee_id, **kw):
    body = {
        "title": "Bins",
        "assignee_id": assignee_id,
        "start_date": "2026-03-02",
        "recurrence": "weekly",
        "end_date": None,
        "notes": "",
    } | kw
    return c.post("/api/chores", json=body)


@pytest.fixture
def pair(make_user, client_for, db):
    ann, bob = make_user("ann"), make_user("bob")
    link(db, ann, bob)
    return ann, bob, client_for(ann), client_for(bob)


# ---- auth ----

@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/calendar/2026-03"),
        ("post", "/api/events"),
        ("put", "/api/events/1"),
        ("delete", "/api/events/1"),
        ("get", "/api/chores"),
        ("post", "/api/chores"),
        ("put", "/api/chores/1"),
        ("delete", "/api/chores/1"),
        ("post", "/api/chores/1/done/2026-03-02"),
        ("delete", "/api/chores/1/done/2026-03-02"),
        ("get", "/api/chores/today?date=2026-03-02"),
    ],
)
def test_requires_login(client, method, path):
    assert getattr(client, method)(path).status_code == 401


# ---- events ----

def test_event_crud(auth_client):
    r = event(auth_client)
    assert r.status_code == 201
    ev = r.json()
    assert ev | {"id": 0} == {
        "id": 0, "owner_id": auth_client.user.id, "title": "Dentist", "date": "2026-03-10",
        "start_time": "09:30:00", "notes": "", "shared": False,
    }
    r = auth_client.put(f"/api/events/{ev['id']}", json={"title": "Doctor", "date": "2026-03-11", "start_time": None})
    assert r.status_code == 200
    assert r.json()["title"] == "Doctor" and r.json()["start_time"] is None
    assert [e["title"] for e in auth_client.get("/api/calendar/2026-03").json()["events"]] == ["Doctor"]
    assert auth_client.delete(f"/api/events/{ev['id']}").status_code == 204
    assert auth_client.get("/api/calendar/2026-03").json()["events"] == []


def test_event_validation(auth_client):
    assert event(auth_client, title="").status_code == 422
    assert event(auth_client, date="2026-02-30").status_code == 422


def test_event_cross_user_404(pair):
    ann, bob, ca, cb = pair
    ev = event(ca, shared=True).json()
    assert cb.put(f"/api/events/{ev['id']}", json={"title": "x", "date": "2026-03-10"}).status_code == 404
    assert cb.delete(f"/api/events/{ev['id']}").status_code == 404
    assert cb.delete("/api/events/999999").status_code == 404


def test_shared_events_visible_only_through_accepted_link(make_user, client_for, db):
    ann, bob, cat, dan = (make_user(n) for n in ("ann", "bob", "cat", "dan"))
    link(db, ann, bob)
    link(db, ann, cat, "pending")
    ca = client_for(ann)
    event(ca, title="Party", shared=True)
    event(ca, title="Private")
    event(ca, title="Next month", date="2026-04-01", shared=True)

    def titles(user):
        return [e["title"] for e in client_for(user).get("/api/calendar/2026-03").json()["events"]]

    assert sorted(titles(ann)) == ["Party", "Private"]
    assert titles(bob) == ["Party"]
    assert titles(cat) == []  # pending link
    assert titles(dan) == []  # no link


def test_calendar_month_validation(auth_client):
    assert auth_client.get("/api/calendar/2026-13").status_code == 422
    assert auth_client.get("/api/calendar/march").status_code == 422


def test_calendar_events_sorted_by_date_then_time(auth_client):
    event(auth_client, title="b", date="2026-03-05", start_time="12:00")
    event(auth_client, title="c", date="2026-03-05", start_time=None)
    event(auth_client, title="a", date="2026-03-05", start_time="08:00")
    event(auth_client, title="z", date="2026-03-01", start_time="23:00")
    assert [e["title"] for e in auth_client.get("/api/calendar/2026-03").json()["events"]] == ["z", "c", "a", "b"]


# ---- chores ----

def test_chore_crud_and_list(pair):
    ann, bob, ca, cb = pair
    r = chore(ca, bob.id)
    assert r.status_code == 201
    ch = r.json()
    assert ch | {"id": 0} == {
        "id": 0, "owner_id": ann.id, "title": "Bins", "notes": "", "start_date": "2026-03-02",
        "recurrence": "weekly", "end_date": None,
        "assignee": {"id": bob.id, "username": "bob", "avatar": None},
    }
    assert [c["id"] for c in ca.get("/api/chores").json()] == [ch["id"]]
    assert [c["id"] for c in cb.get("/api/chores").json()] == [ch["id"]]  # assignee sees it

    r = ca.put(f"/api/chores/{ch['id']}", json={
        "title": "Recycling", "assignee_id": ann.id, "start_date": "2026-03-03", "recurrence": "monthly",
    })
    assert r.status_code == 200
    assert r.json()["title"] == "Recycling" and r.json()["assignee"]["id"] == ann.id
    assert cb.get("/api/chores").json() == []
    assert ca.delete(f"/api/chores/{ch['id']}").status_code == 204
    assert ca.get("/api/chores").json() == []


def test_chore_validation(auth_client):
    me = auth_client.user.id
    assert chore(auth_client, me, title="").status_code == 422
    assert chore(auth_client, me, recurrence="yearly").status_code == 422
    assert chore(auth_client, me, start_date="2026-03-10", end_date="2026-03-09").status_code == 422


def test_chore_assignee_must_be_me_or_accepted_link(make_user, client_for, db):
    ann, bob, cat = make_user("ann"), make_user("bob"), make_user("cat")
    link(db, ann, cat, "pending")
    ca = client_for(ann)
    assert chore(ca, bob.id).status_code == 400  # not linked
    assert chore(ca, cat.id).status_code == 400  # pending
    assert chore(ca, 999999).status_code == 400
    ch = chore(ca, ann.id).json()
    body = {"title": "x", "assignee_id": bob.id, "start_date": "2026-03-02", "recurrence": "none"}
    assert ca.put(f"/api/chores/{ch['id']}", json=body).status_code == 400


def test_only_owner_edits_or_deletes_chore(pair, make_user, client_for):
    ann, bob, ca, cb = pair
    ch = chore(ca, bob.id).json()
    body = {"title": "x", "assignee_id": bob.id, "start_date": "2026-03-02", "recurrence": "none"}
    assert cb.put(f"/api/chores/{ch['id']}", json=body).status_code == 404
    assert cb.delete(f"/api/chores/{ch['id']}").status_code == 404
    eve = client_for(make_user("eve"))
    assert eve.delete(f"/api/chores/{ch['id']}").status_code == 404
    assert ca.delete("/api/chores/999999").status_code == 404


def test_calendar_chore_occurrences(pair):
    ann, bob, ca, cb = pair
    ch = chore(ca, bob.id, end_date="2026-03-16")
    cid = ch.json()["id"]
    expected = [
        {"chore_id": cid, "title": "Bins", "date": d, "owner_id": ann.id, "done": False,
         "assignee": {"id": bob.id, "username": "bob", "avatar": None}}
        for d in ("2026-03-02", "2026-03-09", "2026-03-16")
    ]
    assert ca.get("/api/calendar/2026-03").json()["chores"] == expected
    assert cb.get("/api/calendar/2026-03").json()["chores"] == expected
    assert ca.get("/api/calendar/2026-04").json()["chores"] == []


def test_chores_of_others_are_invisible(pair):
    ann, bob, ca, cb = pair
    chore(ca, ann.id)  # ann's own chore: bob is linked but not involved
    assert cb.get("/api/chores").json() == []
    assert cb.get("/api/calendar/2026-03").json()["chores"] == []


def test_completion_toggle_and_permissions(pair, make_user, client_for):
    ann, bob, ca, cb = pair
    cid = chore(ca, bob.id).json()["id"]
    assert cb.post(f"/api/chores/{cid}/done/2026-03-09").status_code == 204
    assert cb.post(f"/api/chores/{cid}/done/2026-03-09").status_code == 204  # idempotent
    done = {c["date"]: c["done"] for c in ca.get("/api/calendar/2026-03").json()["chores"]}
    assert done["2026-03-09"] is True and done["2026-03-02"] is False
    assert ca.delete(f"/api/chores/{cid}/done/2026-03-09").status_code == 204  # owner can undo
    assert not any(c["done"] for c in cb.get("/api/calendar/2026-03").json()["chores"])

    eve = client_for(make_user("eve"))
    assert eve.post(f"/api/chores/{cid}/done/2026-03-09").status_code == 404
    assert eve.delete(f"/api/chores/{cid}/done/2026-03-09").status_code == 404
    assert cb.post("/api/chores/999999/done/2026-03-09").status_code == 404


def test_completion_date_must_be_an_occurrence(pair):
    ann, bob, ca, cb = pair
    cid = chore(ca, bob.id, end_date="2026-03-16").json()["id"]
    assert cb.post(f"/api/chores/{cid}/done/2026-03-10").status_code == 400  # wrong weekday
    assert cb.post(f"/api/chores/{cid}/done/2026-02-23").status_code == 400  # before start
    assert cb.post(f"/api/chores/{cid}/done/2026-03-23").status_code == 400  # after end
    assert cb.delete(f"/api/chores/{cid}/done/2026-03-10").status_code == 400
    assert cb.post(f"/api/chores/{cid}/done/not-a-date").status_code == 422


def test_today_lists_my_assigned_occurrences(pair):
    ann, bob, ca, cb = pair
    mine = chore(cb, bob.id, title="Dishes", recurrence="daily").json()["id"]
    theirs = chore(ca, bob.id, title="Bins").json()["id"]
    chore(ca, ann.id, title="Ann only", recurrence="daily")
    cb.post(f"/api/chores/{theirs}/done/2026-03-09")

    r = cb.get("/api/chores/today?date=2026-03-09")
    assert r.status_code == 200
    assert sorted((c["chore_id"], c["title"], c["done"]) for c in r.json()) == sorted(
        [(mine, "Dishes", False), (theirs, "Bins", True)]
    )
    assert [c["title"] for c in cb.get("/api/chores/today?date=2026-03-10").json()] == ["Dishes"]
    assert cb.get("/api/chores/today").status_code == 422


def test_unlinked_assignee_chores_remain_visible(pair, db):
    """Removing the link keeps existing chores: the owner and the assignee both still see them,
    and the owner can still edit as long as the assignee is unchanged."""
    ann, bob, ca, cb = pair
    cid = chore(ca, bob.id).json()["id"]
    db.query(Link).delete()
    db.flush()
    assert [c["id"] for c in ca.get("/api/chores").json()] == [cid]
    assert [c["chore_id"] for c in ca.get("/api/calendar/2026-03").json()["chores"]][:1] == [cid]
    assert [c["chore_id"] for c in cb.get("/api/chores/today?date=2026-03-02").json()] == [cid]
    body = {"title": "Bins!", "assignee_id": bob.id, "start_date": "2026-03-02", "recurrence": "weekly"}
    assert ca.put(f"/api/chores/{cid}", json=body).status_code == 200
    # but a new chore can't be given to them
    assert chore(ca, bob.id).status_code == 400
