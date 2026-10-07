from decimal import Decimal as D

import pytest

from app.accounts import Link
from app.budget import BudgetLine, summarize


def line(kind, a, b=None):
    return BudgetLine(kind=kind, name=kind, a=D(a), b=None if b is None else D(b))


# ---- unit: summarize ----

def test_summarize_empty_is_all_zero():
    s = summarize([]).model_dump()
    assert s == {
        "assets": 0,
        "debit": {"start": 0, "end": 0, "difference": 0},
        "income": {"pre_tax": 0, "post_tax": 0},
        "loans": 0,
        "credit": {"start": 0, "end": 0, "difference": 0},
        "expenses": {"budgeted": 0, "actual": 0, "difference": 0},
        "savings": {"budgeted": 0, "actual": 0, "difference": 0},
        "remainder": {"budgeted": 0, "actual": 0, "difference": 0},
        "net_worth": 0,
    }


def test_summarize_all_kinds_exact_decimals():
    s = summarize([
        line("asset", "10000.10"),
        line("asset", "0.20"),
        line("debit", "1000.00", "1250.55"),
        line("debit", "500.00", "400.00"),
        line("income", "5000.00", "3800.10"),
        line("income", "1000.00", "800.00"),
        line("loan", "20000.00"),
        line("credit", "300.00", "450.25"),
        line("expense", "1500.00", "1620.30"),
        line("expense", "400.00", "350.00"),
        line("savings", "500.00", "600.00"),
    ])
    assert s.assets == D("10000.30")
    assert (s.debit.start, s.debit.end, s.debit.difference) == (D("1500.00"), D("1650.55"), D("150.55"))
    assert (s.income.pre_tax, s.income.post_tax) == (D("6000.00"), D("4600.10"))
    assert s.loans == D("20000.00")
    assert (s.credit.start, s.credit.end, s.credit.difference) == (D("300.00"), D("450.25"), D("150.25"))
    # expenses: positive difference = under budget
    assert (s.expenses.budgeted, s.expenses.actual, s.expenses.difference) == (D("1900.00"), D("1970.30"), D("-70.30"))
    # savings: positive difference = saved more than planned
    assert (s.savings.budgeted, s.savings.actual, s.savings.difference) == (D("500.00"), D("600.00"), D("100.00"))
    # remainder = post-tax income - expenses - savings
    assert s.remainder.budgeted == D("4600.10") - D("1900.00") - D("500.00")
    assert s.remainder.actual == D("4600.10") - D("1970.30") - D("600.00")
    assert s.remainder.difference == s.remainder.actual - s.remainder.budgeted
    # net worth = assets + debit end - loans - credit end
    assert s.net_worth == D("10000.30") + D("1650.55") - D("20000.00") - D("450.25")
    assert str(s.net_worth) == "-8799.40"


def test_summarize_missing_b_counts_as_zero():
    s = summarize([line("debit", "100.00"), line("income", "50.00"), line("expense", "20.00"), line("savings", "10.00")])
    assert (s.debit.end, s.debit.difference) == (0, D("-100.00"))
    assert s.income.post_tax == 0
    assert (s.expenses.actual, s.expenses.difference) == (0, D("20.00"))
    assert (s.savings.actual, s.savings.difference) == (0, D("-10.00"))
    assert (s.remainder.budgeted, s.remainder.actual) == (D("-30.00"), 0)
    assert s.net_worth == 0


def test_summarize_negative_balances():
    s = summarize([line("debit", "-50.00", "-120.00"), line("credit", "-10.00", "-5.00")])
    assert s.debit.difference == D("-70.00")
    assert s.credit.difference == D("5.00")
    assert s.net_worth == D("-120.00") - D("-5.00")


# ---- API ----

def add(c, month, kind, name, a, b=None):
    body = {"kind": kind, "name": name, "a": a} | ({} if b is None else {"b": b})
    return c.post(f"/api/budget/{month}/lines", json=body)


def test_requires_auth(client):
    assert client.get("/api/budget/2026-10").status_code == 401
    assert client.post("/api/budget/2026-10/lines", json={"kind": "asset", "name": "x", "a": "1"}).status_code == 401
    assert client.patch("/api/budget/lines/1", json={"name": "x", "a": "1"}).status_code == 401
    assert client.delete("/api/budget/lines/1").status_code == 401
    assert client.post("/api/budget/2026-10/copy-previous").status_code == 401
    assert client.get("/api/budget/2026-10/shared/1").status_code == 401


def test_empty_month(auth_client):
    r = auth_client.get("/api/budget/2026-10")
    assert r.status_code == 200
    body = r.json()
    assert body["lines"] == []
    assert body["summary"]["net_worth"] == "0.00"


@pytest.mark.parametrize("month", ["2026-13", "2026-00", "26-10", "2026-1", "october"])
def test_invalid_month_422(auth_client, month):
    assert auth_client.get(f"/api/budget/{month}").status_code == 422
    assert add(auth_client, month, "asset", "x", "1").status_code == 422
    assert auth_client.post(f"/api/budget/{month}/copy-previous").status_code == 422
    assert auth_client.get(f"/api/budget/{month}/shared/1").status_code == 422


def test_create_list_and_summary(auth_client):
    r = add(auth_client, "2026-10", "income", "Salary", "5000", "3800.50")
    assert r.status_code == 201
    created = r.json()
    assert created | {"id": 0} == {
        "id": 0, "owner_id": auth_client.user.id, "partner_id": None, "user_share": 50, "partner_share": 50, "month": "2026-10", "kind": "income",
        "name": "Salary", "a": "5000.00", "b": "3800.50", "position": 0,
    }
    add(auth_client, "2026-10", "expense", "Rent", "1500")
    add(auth_client, "2026-11", "expense", "Other month", "99")

    body = auth_client.get("/api/budget/2026-10").json()
    assert [(x["name"], x["position"]) for x in body["lines"]] == [("Salary", 0), ("Rent", 1)]
    assert body["summary"]["remainder"] == {"budgeted": "2300.50", "actual": "3800.50", "difference": "1500.00"}


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "expense", "name": "x", "a": "-1"},
        {"kind": "income", "name": "x", "a": "1", "b": "-1"},
        {"kind": "asset", "name": "x", "a": "1.234"},
        {"kind": "asset", "name": "  ", "a": "1"},
        {"kind": "bogus", "name": "x", "a": "1"},
        {"kind": "asset", "name": "x", "a": "10000000000"},
    ],
)
def test_create_validation_422(auth_client, body):
    assert auth_client.post("/api/budget/2026-10/lines", json=body).status_code == 422


def test_debit_and_credit_may_be_negative(auth_client):
    assert add(auth_client, "2026-10", "debit", "Checking", "-20", "-5").status_code == 201
    assert add(auth_client, "2026-10", "credit", "Card", "-3", "-1").status_code == 201


def test_update_line(auth_client):
    line_id = add(auth_client, "2026-10", "expense", "Food", "400").json()["id"]
    r = auth_client.patch(f"/api/budget/lines/{line_id}", json={"name": "Groceries", "a": "450", "b": "432.10"})
    assert r.status_code == 200
    assert (r.json()["name"], r.json()["a"], r.json()["b"]) == ("Groceries", "450.00", "432.10")
    assert auth_client.patch(f"/api/budget/lines/{line_id}", json={"name": "x", "a": "-1"}).status_code == 422


def test_delete_line(auth_client):
    line_id = add(auth_client, "2026-10", "asset", "Car", "9000").json()["id"]
    assert auth_client.delete(f"/api/budget/lines/{line_id}").status_code == 204
    assert auth_client.get("/api/budget/2026-10").json()["lines"] == []
    assert auth_client.delete(f"/api/budget/lines/{line_id}").status_code == 404


def test_other_users_lines_are_404(make_user, client_for):
    ann, bob = make_user(), make_user()
    ca, cb = client_for(ann), client_for(bob)
    line_id = add(ca, "2026-10", "asset", "Car", "9000").json()["id"]
    assert cb.get("/api/budget/2026-10").json()["lines"] == []
    assert cb.patch(f"/api/budget/lines/{line_id}", json={"name": "Mine", "a": "1"}).status_code == 404
    assert cb.delete(f"/api/budget/lines/{line_id}").status_code == 404
    assert ca.get("/api/budget/2026-10").json()["lines"][0]["name"] == "Car"


def test_copy_previous(auth_client):
    add(auth_client, "2025-12", "income", "Salary", "5000", "3800")
    add(auth_client, "2025-12", "expense", "Rent", "1500", "1400")
    add(auth_client, "2025-12", "savings", "Holiday", "300", "250")
    add(auth_client, "2025-12", "debit", "Checking", "1000", "1200")
    add(auth_client, "2025-12", "credit", "Card", "100")
    add(auth_client, "2025-12", "asset", "Car", "9000")
    r = auth_client.post("/api/budget/2026-01/copy-previous")
    assert r.status_code == 201
    lines = r.json()["lines"]
    # plans are kept, actuals cleared, and month-end balances become the new day-1 balances
    assert [(x["month"], x["kind"], x["name"], x["a"], x["b"]) for x in lines] == [
        ("2026-01", "income", "Salary", "5000.00", "3800.00"),
        ("2026-01", "expense", "Rent", "1500.00", None),
        ("2026-01", "savings", "Holiday", "300.00", None),
        ("2026-01", "debit", "Checking", "1200.00", None),
        ("2026-01", "credit", "Card", "100.00", None),
        ("2026-01", "asset", "Car", "9000.00", None),
    ]
    assert r.json()["summary"]["remainder"] == {"budgeted": "2000.00", "actual": "3800.00", "difference": "1800.00"}
    assert len(auth_client.get("/api/budget/2025-12").json()["lines"]) == 6  # source untouched
    assert auth_client.post("/api/budget/2026-01/copy-previous").status_code == 409


def test_copy_previous_with_nothing_to_copy_404(auth_client):
    assert auth_client.post("/api/budget/2026-01/copy-previous").status_code == 404


def test_copy_previous_only_copies_own_lines(make_user, client_for):
    ann, bob = make_user(), make_user()
    add(client_for(ann), "2026-09", "asset", "Car", "9000")
    assert client_for(bob).post("/api/budget/2026-10/copy-previous").status_code == 404


# ---- shared ----

def link(db, a, b, status="accepted"):
    db.add(Link(requester_id=a.id, addressee_id=b.id, status=status))
    db.flush()


def test_shared_view_shows_only_lines_shared_by_the_pair(db, make_user, client_for):
    ann, bob, cat = make_user("ann"), make_user("bob", avatar="data:image/png;base64,AA=="), make_user()
    link(db, bob, ann)
    link(db, ann, cat)
    ca, cb = client_for(ann), client_for(bob)
    add(ca, "2026-10", "income", "Ann pay", "4000", "3000")
    add(cb, "2026-10", "asset", "Bob car", "9000")
    shared_add(ca, "2026-10", bob, "income", "Rental", "2000", "1500")
    shared_add(cb, "2026-10", ann, "expense", "Rent", "1000", "1000")
    shared_add(ca, "2026-10", cat, "expense", "Cat food", "50")
    shared_add(cb, "2026-11", ann, "expense", "Next month", "1")

    r = ca.get(f"/api/budget/2026-10/shared/{bob.id}")
    assert r.status_code == 200
    body = r.json()
    assert body["members"] == [
        {"id": ann.id, "username": "ann", "avatar": None},
        {"id": bob.id, "username": "bob", "avatar": "data:image/png;base64,AA=="},
    ]
    assert sorted(x["name"] for x in body["lines"]) == ["Rent", "Rental"]
    assert body["summary"]["income"] == {"pre_tax": "2000.00", "post_tax": "1500.00"}
    assert body["summary"]["remainder"]["actual"] == "500.00"
    assert body["summary"]["assets"] == "0.00"
    assert "per_member" not in body

    # works from the other side too
    assert cb.get(f"/api/budget/2026-10/shared/{ann.id}").json()["lines"] == body["lines"]


def test_linked_partner_cannot_edit_personal_lines(db, make_user, client_for):
    ann, bob = make_user(), make_user()
    link(db, ann, bob)
    cb = client_for(bob)
    line_id = add(client_for(ann), "2026-10", "asset", "Car", "9000").json()["id"]
    assert cb.patch(f"/api/budget/lines/{line_id}", json={"name": "Mine", "a": "1"}).status_code == 404
    assert cb.delete(f"/api/budget/lines/{line_id}").status_code == 404


def test_shared_view_requires_accepted_link(db, make_user, client_for):
    ann, bob, cat = make_user(), make_user(), make_user()
    link(db, ann, bob, status="pending")
    ca = client_for(ann)
    assert ca.get(f"/api/budget/2026-10/shared/{bob.id}").status_code == 404
    assert ca.get(f"/api/budget/2026-10/shared/{cat.id}").status_code == 404
    assert ca.get(f"/api/budget/2026-10/shared/{ann.id}").status_code == 404
    assert ca.get("/api/budget/2026-10/shared/999999").status_code == 404


# ---- shared lines ----

def shared_add(c, month, other, kind, name, a, b=None, **shares):
    body = {"kind": kind, "name": name, "a": a, "b": b, **shares}
    return c.post(f"/api/budget/{month}/shared/{other.id}/lines", json=body)


def test_shared_lines_are_editable_by_both_members(db, make_user, client_for):
    ann, bob = make_user(), make_user()
    link(db, ann, bob)
    ca, cb = client_for(ann), client_for(bob)
    r = shared_add(ca, "2026-10", bob, "loan", "Mortgage", "200000")
    assert r.status_code == 201
    assert (r.json()["owner_id"], r.json()["partner_id"]) == (ann.id, bob.id)
    line_id = r.json()["id"]

    assert cb.patch(f"/api/budget/lines/{line_id}", json={"name": "Home loan", "a": "199000"}).status_code == 200
    lines = ca.get(f"/api/budget/2026-10/shared/{bob.id}").json()["lines"]
    assert [(x["name"], x["a"], x["partner_id"]) for x in lines] == [("Home loan", "199000.00", bob.id)]
    assert cb.delete(f"/api/budget/lines/{line_id}").status_code == 204
    assert ca.get(f"/api/budget/2026-10/shared/{bob.id}").json()["lines"] == []


def test_personal_view_includes_your_share_of_every_shared_line(db, make_user, client_for):
    ann, bob = make_user(), make_user()
    link(db, ann, bob)
    ca, cb = client_for(ann), client_for(bob)
    add(ca, "2026-10", "income", "Pay", "4000", "3000")
    shared_add(cb, "2026-10", ann, "expense", "Rent", "2000", "1800")
    shared_add(cb, "2026-10", ann, "savings", "Holiday", "400", user_share=25, partner_share=75)
    shared_add(cb, "2026-10", ann, "asset", "House", "300000", user_share=100, partner_share=100)
    shared_add(cb, "2026-10", ann, "debit", "Joint", "1000", "1201")
    shared_add(cb, "2026-10", ann, "credit", "Card", "100", "300")
    shared_add(cb, "2026-10", ann, "loan", "Mortgage", "200000", user_share=0, partner_share=100)
    shared_add(cb, "2026-10", ann, "income", "Rental", "1000", "800")

    body = ca.get("/api/budget/2026-10").json()
    assert [(x["name"], x["a"], x["b"]) for x in body["lines"]] == [
        ("Pay", "4000.00", "3000.00"),
        ("Rent", "1000.00", "900.00"),
        ("Holiday", "300.00", None),
        ("House", "300000.00", None),
        ("Joint", "500.00", "600.50"),
        ("Card", "50.00", "150.00"),
        ("Mortgage", "200000.00", None),
        ("Rental", "500.00", "400.00"),
    ]
    assert body["summary"]["expenses"]["actual"] == "900.00"
    assert body["summary"]["net_worth"] == "100450.50"
    # bob owns the lines, so user_share is his
    assert [(x["name"], x["a"]) for x in cb.get("/api/budget/2026-10").json()["lines"][1:4]] == [
        ("Holiday", "100.00"), ("House", "300000.00"), ("Joint", "500.00"),
    ]


def test_shares_are_editable_and_bounded(db, make_user, client_for):
    ann, bob = make_user(), make_user()
    link(db, ann, bob)
    ca, cb = client_for(ann), client_for(bob)
    assert shared_add(ca, "2026-10", bob, "asset", "Car", "9000", user_share=101).status_code == 422
    assert shared_add(ca, "2026-10", bob, "asset", "Car", "9000", partner_share=-1).status_code == 422
    line_id = shared_add(ca, "2026-10", bob, "asset", "Car", "9000").json()["id"]
    r = cb.patch(f"/api/budget/lines/{line_id}", json={"name": "Car", "a": "9000", "user_share": 70, "partner_share": 30})
    assert (r.json()["user_share"], r.json()["partner_share"]) == (70, 30)
    assert cb.get("/api/budget/2026-10").json()["lines"][0]["a"] == "2700.00"
    assert ca.post("/api/budget/2026-11/shared/%d/copy-previous" % bob.id).json()["lines"][0]["user_share"] == 70


def test_shared_lines_need_an_accepted_link(db, make_user, client_for):
    ann, bob, cat = make_user(), make_user(), make_user()
    link(db, ann, bob)
    link(db, ann, cat, status="pending")
    ca, cb = client_for(ann), client_for(bob)
    assert shared_add(ca, "2026-10", cat, "expense", "Rent", "1").status_code == 404
    assert shared_add(ca, "2026-10", ann, "expense", "Rent", "1").status_code == 404
    line_id = shared_add(ca, "2026-10", bob, "expense", "Rent", "1000").json()["id"]
    assert client_for(cat).patch(f"/api/budget/lines/{line_id}", json={"name": "x", "a": "1"}).status_code == 404

    db.query(Link).filter_by(requester_id=ann.id, addressee_id=bob.id).delete()
    db.flush()
    assert cb.patch(f"/api/budget/lines/{line_id}", json={"name": "x", "a": "1"}).status_code == 404
    assert cb.get("/api/budget/2026-10").json()["lines"] == []


def test_shared_copy_previous(db, make_user, client_for):
    ann, bob = make_user(), make_user()
    link(db, ann, bob)
    ca, cb = client_for(ann), client_for(bob)
    shared_add(ca, "2026-09", bob, "expense", "Rent", "2000", "2000")
    add(ca, "2026-09", "asset", "Car", "9000")

    r = cb.post(f"/api/budget/2026-10/shared/{ann.id}/copy-previous")
    assert r.status_code == 201
    assert [(x["name"], x["a"], x["b"]) for x in r.json()["lines"]] == [("Rent", "2000.00", None)]
    assert cb.post(f"/api/budget/2026-10/shared/{ann.id}/copy-previous").status_code == 409
    assert cb.post(f"/api/budget/2026-12/shared/{ann.id}/copy-previous").status_code == 404
    # personal copy leaves shared lines alone
    assert [x["name"] for x in ca.post("/api/budget/2026-10/copy-previous").json()["lines"]] == ["Car", "Rent"]
