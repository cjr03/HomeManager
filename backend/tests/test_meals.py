from datetime import date
import pytest
from sqlalchemy import func, select

from app.agents import (
    AgentError,
    DayPlan,
    GeneratedDay,
    GeneratedMeal,
    GroceryItem,
    GroceryList,
    PlannedMeal,
    ShoppingItem,
    ShoppingList,
    Slot,
    WeekMeals,
)
from app.accounts import Link
from app.main import app
from app.meals import MealEntry, ShoppingListRow, day_plans, get_agents, pantry_remainder, week_dates

SUNDAY = "2026-10-04"
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class FakeAgents:
    """Stands in for app.agents: records calls and returns canned results (or raises)."""

    def __init__(self, error: AgentError | None = None):
        self.calls: dict[str, tuple] = {}
        self.error = error

    def _record(self, name, *args):
        self.calls[name] = args
        if self.error:
            raise self.error

    def groceries_needed(self, week, household_size):
        self._record("groceries_needed", week, household_size)
        return GroceryList(items=[GroceryItem(name="Spaghetti", quantity=500, unit="g")])

    def shopping_list(self, needed, have):
        self._record("shopping_list", needed, have)
        return ShoppingList(items=[ShoppingItem(name="Spaghetti", quantity=250, unit="g", category="pantry")])

    def generate_meals(self, have, preferences, household_size, slots):
        self._record("generate_meals", have, preferences, household_size, slots)

        def meal(slot, day):
            return GeneratedMeal(
                slot=slot,
                name=f"{day} {slot}",
                servings=household_size,
                ingredients=[GroceryItem(name="Rice", quantity=100, unit="g")],
                instructions=["Cook.", "Eat."],
            )

        return WeekMeals(days=[GeneratedDay(weekday=d, meals=[meal(s, d) for s in slots]) for d in WEEKDAYS])


@pytest.fixture
def fake():
    agents = FakeAgents()
    app.dependency_overrides[get_agents] = lambda: agents
    yield agents
    app.dependency_overrides.pop(get_agents, None)


def put_meal(c, day, slot, **body):
    return c.put(f"/api/meals/{day}/{slot}", json={"name": "Soup", **body})


def link(db, a, b, status="accepted"):
    db.add(Link(requester_id=a.id, addressee_id=b.id, status=status))
    db.flush()


def names(c):
    return [m["name"] for m in c.get("/api/meals?month=2026-10").json()]


# ---- unit ----


def test_week_dates_are_sunday_to_saturday():
    days = week_dates(date(2026, 10, 4))
    assert days[0] == date(2026, 10, 4) and days[-1] == date(2026, 10, 10)
    assert len(days) == 7


def test_day_plans_groups_entries_by_date_in_order():
    entries = [
        MealEntry(date=date(2026, 10, 6), slot="dinner", name="Stew"),
        MealEntry(date=date(2026, 10, 4), slot="lunch", name="Salad"),
        MealEntry(date=date(2026, 10, 6), slot="breakfast", name="Oats"),
    ]
    assert day_plans(entries) == [
        DayPlan(weekday="Sunday", meals=[PlannedMeal(slot=Slot.lunch, name="Salad")]),
        DayPlan(
            weekday="Tuesday",
            meals=[PlannedMeal(slot=Slot.breakfast, name="Oats"), PlannedMeal(slot=Slot.dinner, name="Stew")],
        ),
    ]


def test_day_plans_empty():
    assert day_plans([]) == []


# ---- auth ----


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/meals?month=2026-10"),
        ("put", f"/api/meals/{SUNDAY}/dinner"),
        ("delete", f"/api/meals/{SUNDAY}/dinner"),
        ("get", "/api/pantry"),
        ("put", "/api/pantry"),
        ("post", "/api/pantry/generate"),
        ("post", "/api/meals/groceries-needed"),
        ("post", "/api/meals/shopping-list"),
        ("post", "/api/meals/generate"),
    ],
)
def test_requires_login(client, method, path):
    assert client.request(method.upper(), path, json={}).status_code == 401


# ---- meal entries ----


def test_upsert_list_and_delete(auth_client):
    r = put_meal(
        auth_client,
        SUNDAY,
        "dinner",
        servings=2,
        ingredients=[{"name": "Rice", "quantity": 100, "unit": "g"}],
        instructions=["Boil."],
    )
    assert r.status_code == 200
    assert r.json() == {
        "date": SUNDAY,
        "slot": "dinner",
        "name": "Soup",
        "servings": 2,
        "ingredients": [{"name": "Rice", "quantity": 100.0, "unit": "g"}],
        "instructions": ["Boil."],
    }

    r = put_meal(auth_client, SUNDAY, "dinner", name="Curry")
    assert r.json()["name"] == "Curry" and r.json()["ingredients"] is None

    put_meal(auth_client, "2026-10-31", "snack")
    put_meal(auth_client, "2026-11-01", "snack")
    month = auth_client.get("/api/meals?month=2026-10").json()
    assert [(m["date"], m["slot"], m["name"]) for m in month] == [
        (SUNDAY, "dinner", "Curry"),
        ("2026-10-31", "snack", "Soup"),
    ]

    assert auth_client.delete(f"/api/meals/{SUNDAY}/dinner").status_code == 204
    assert [m["date"] for m in auth_client.get("/api/meals?month=2026-10").json()] == ["2026-10-31"]


@pytest.mark.parametrize("month", ["2026-13", "2026-1", "oct", ""])
def test_list_rejects_bad_month(auth_client, month):
    assert auth_client.get(f"/api/meals?month={month}").status_code == 422


@pytest.mark.parametrize(
    "path,body",
    [
        (f"/api/meals/{SUNDAY}/brunch", {"name": "x"}),
        ("/api/meals/2026-02-30/dinner", {"name": "x"}),
        (f"/api/meals/{SUNDAY}/dinner", {"name": "  "}),
        (f"/api/meals/{SUNDAY}/dinner", {"name": "x", "servings": 0}),
    ],
)
def test_put_validates(auth_client, path, body):
    assert auth_client.put(path, json=body).status_code == 422


def test_users_only_see_their_own_meals(auth_client, make_user, client_for):
    other = client_for(make_user())
    put_meal(other, SUNDAY, "dinner", name="Theirs")
    put_meal(auth_client, SUNDAY, "dinner", name="Mine")
    assert other.delete(f"/api/meals/{SUNDAY}/lunch").status_code == 204
    assert [m["name"] for m in auth_client.get("/api/meals?month=2026-10").json()] == ["Mine"]
    other.delete(f"/api/meals/{SUNDAY}/dinner")
    assert [m["name"] for m in auth_client.get("/api/meals?month=2026-10").json()] == ["Mine"]


# ---- pantry ----


def test_pantry_replace(auth_client, make_user, client_for):
    assert auth_client.get("/api/pantry").json() == {"items": []}
    items = [{"name": "Milk", "quantity": 1.5, "unit": "l"}, {"name": "Eggs", "quantity": 6, "unit": ""}]
    r = auth_client.put("/api/pantry", json={"items": items})
    assert r.status_code == 200 and r.json() == {"items": items}
    auth_client.put("/api/pantry", json={"items": items[1:]})
    assert auth_client.get("/api/pantry").json() == {"items": items[1:]}
    assert client_for(make_user()).get("/api/pantry").json() == {"items": []}


@pytest.mark.parametrize(
    "item",
    [
        {"name": "Milk", "quantity": 0},
        {"name": "", "quantity": 1},
        {"name": "x" * 201, "quantity": 1},
        {"name": "Milk", "quantity": 1, "unit": "x" * 21},
    ],
)
def test_pantry_validates(auth_client, item):
    assert auth_client.put("/api/pantry", json={"items": [item]}).status_code == 422


def g(name, quantity, unit=""):
    return GroceryItem(name=name, quantity=quantity, unit=unit)


def test_pantry_remainder():
    have = [g("Spaghetti", 300, "g"), g("Rice", 1, "kg"), g("Milk", 1, "l")]
    bought = [g("spaghetti", 250, "G"), g("Milk", 1.1, "l"), g("Onion", 3)]
    used = [g("SPAGHETTI ", 500, "g"), g("Milk", 2.1, "l"), g("Onion", 2), g("Garlic", 1)]
    # Matched by name and unit ignoring case/space; first spelling kept; used up or never had -> dropped.
    assert pantry_remainder(have, bought, used) == [g("Spaghetti", 50, "g"), g("Rice", 1, "kg"), g("Onion", 1)]
    assert pantry_remainder([g("Rice", 1, "kg")], [], [g("Rice", 500, "g")]) == [g("Rice", 1, "kg")]  # no unit conversion


def test_generate_pantry(auth_client, fake, make_user, client_for):
    other = client_for(make_user())
    other.put("/api/pantry", json={"items": [{"name": "Eggs", "quantity": 6, "unit": ""}]})
    put_meal(auth_client, SUNDAY, "dinner")
    auth_client.put(
        "/api/pantry",
        json={"items": [{"name": "spaghetti", "quantity": 300, "unit": "g"}, {"name": "Rice", "quantity": 1, "unit": "kg"}]},
    )
    # have 300 g + bought 250 g - needed 500 g = 50 g spaghetti; rice untouched.
    expected = {"items": [{"name": "spaghetti", "quantity": 50.0, "unit": "g"}, {"name": "Rice", "quantity": 1.0, "unit": "kg"}]}
    r = auth_client.post("/api/pantry/generate", json={"week_start": SUNDAY})
    assert r.status_code == 200 and r.json() == expected
    assert auth_client.get("/api/pantry").json() == expected
    assert fake.calls["shopping_list"][1] == [g("spaghetti", 300, "g"), g("Rice", 1, "kg")]
    assert other.get("/api/pantry").json() == {"items": [{"name": "Eggs", "quantity": 6.0, "unit": ""}]}


def long_unit_shopping(needed, have):
    return ShoppingList(items=[ShoppingItem(name="Celery", quantity=1, unit="bunch (about 6 stalks)", category="produce")])


@pytest.mark.parametrize(
    "meals,error,shopping,status,detail",
    [
        (False, None, None, 400, "No meals were planned last week"),
        (True, AgentError("Try again."), None, 502, "Try again."),
        (True, None, long_unit_shopping, 502, "The meal assistant returned an item the pantry can't hold. Please try again."),
    ],
)
def test_generate_pantry_failure_keeps_pantry(auth_client, fake, meals, error, shopping, status, detail):
    items = [{"name": "Rice", "quantity": 1.0, "unit": "kg"}]
    auth_client.put("/api/pantry", json={"items": items})
    if meals:
        put_meal(auth_client, SUNDAY, "dinner")
    fake.error = error
    if shopping:
        fake.shopping_list = shopping
    r = auth_client.post("/api/pantry/generate", json={"week_start": SUNDAY})
    assert r.status_code == status and r.json() == {"detail": detail}
    assert auth_client.get("/api/pantry").json() == {"items": items}


@pytest.mark.parametrize("week_start", ["2026-10-05", "nope"])
def test_generate_pantry_week_must_be_a_sunday(auth_client, fake, week_start):
    assert auth_client.post("/api/pantry/generate", json={"week_start": week_start}).status_code == 422


# ---- agents ----


@pytest.mark.parametrize("path", ["groceries-needed", "shopping-list", "generate"])
@pytest.mark.parametrize("week_start", ["2026-10-05", "nope"])
def test_week_start_must_be_a_sunday(auth_client, fake, path, week_start):
    assert auth_client.post(f"/api/meals/{path}", json={"week_start": week_start}).status_code == 422


def test_groceries_needed(auth_client, fake, db):
    auth_client.user.household_size = 3
    db.flush()
    put_meal(auth_client, "2026-10-05", "dinner", name="Stew")
    put_meal(auth_client, "2026-10-11", "dinner", name="Next week")
    r = auth_client.post("/api/meals/groceries-needed", json={"week_start": SUNDAY})
    assert r.status_code == 200
    assert r.json() == {"items": [{"name": "Spaghetti", "quantity": 500.0, "unit": "g"}]}
    week, size = fake.calls["groceries_needed"]
    assert size == 3
    assert week == [DayPlan(weekday="Monday", meals=[PlannedMeal(slot=Slot.dinner, name="Stew")])]


@pytest.mark.parametrize("path", ["groceries-needed", "shopping-list"])
def test_empty_week_is_400(auth_client, fake, make_user, client_for, path):
    put_meal(client_for(make_user()), SUNDAY, "dinner")  # someone else's meal doesn't count
    r = auth_client.post(f"/api/meals/{path}", json={"week_start": SUNDAY})
    assert r.status_code == 400
    assert fake.calls == {}


def test_shopping_list(auth_client, fake):
    put_meal(auth_client, SUNDAY, "dinner")
    auth_client.put("/api/pantry", json={"items": [{"name": "Spaghetti", "quantity": 250, "unit": "g"}]})
    r = auth_client.post("/api/meals/shopping-list", json={"week_start": SUNDAY})
    assert r.status_code == 200
    assert r.json() == {
        "needed": {"items": [{"name": "Spaghetti", "quantity": 500.0, "unit": "g"}]},
        "shopping": {"items": [{"name": "Spaghetti", "quantity": 250.0, "unit": "g", "category": "pantry"}]},
    }
    needed, have = fake.calls["shopping_list"]
    assert needed.items[0].name == "Spaghetti"
    assert have == [GroceryItem(name="Spaghetti", quantity=250, unit="g")]


def test_generate_saves_week_with_preferences(auth_client, fake, db):
    auth_client.user.household_size = 2
    auth_client.user.preferences = {"diet": "vegan"}
    db.flush()
    auth_client.put("/api/pantry", json={"items": [{"name": "Rice", "quantity": 1, "unit": "kg"}]})
    r = auth_client.post("/api/meals/generate", json={"week_start": SUNDAY, "slots": ["dinner", "lunch"]})
    assert r.status_code == 200
    saved = r.json()
    assert len(saved) == 14
    assert saved[0] == {
        "date": SUNDAY,
        "slot": "lunch",
        "name": "Sunday lunch",
        "servings": 2,
        "ingredients": [{"name": "Rice", "quantity": 100.0, "unit": "g"}],
        "instructions": ["Cook.", "Eat."],
    }
    assert {(m["date"], m["name"]) for m in saved} >= {("2026-10-05", "Monday dinner"), ("2026-10-10", "Saturday lunch")}
    have, prefs, size, slots = fake.calls["generate_meals"]
    assert have == [GroceryItem(name="Rice", quantity=1, unit="kg")]
    assert [p.diet for p in prefs] == ["vegan"] and size == 2 and slots == [Slot.dinner, Slot.lunch]
    assert len(auth_client.get("/api/meals?month=2026-10").json()) == 14


def test_generate_defaults_to_all_slots(auth_client, fake):
    r = auth_client.post("/api/meals/generate", json={"week_start": SUNDAY})
    assert len(r.json()) == 28
    assert fake.calls["generate_meals"][3] == list(Slot)


def test_generate_keeps_filled_slots_unless_overwrite(auth_client, fake):
    put_meal(auth_client, SUNDAY, "dinner", name="Keep me")
    saved = auth_client.post("/api/meals/generate", json={"week_start": SUNDAY, "slots": ["dinner"]}).json()
    assert len(saved) == 6 and SUNDAY not in [m["date"] for m in saved]
    names = {m["date"]: m["name"] for m in auth_client.get("/api/meals?month=2026-10").json()}
    assert names[SUNDAY] == "Keep me"

    saved = auth_client.post(
        "/api/meals/generate", json={"week_start": SUNDAY, "slots": ["dinner"], "overwrite": True}
    ).json()
    assert len(saved) == 7
    names = {m["date"]: m["name"] for m in auth_client.get("/api/meals?month=2026-10").json()}
    assert names[SUNDAY] == "Sunday dinner"


@pytest.mark.parametrize(
    "path,json",
    [
        ("groceries-needed", {"week_start": SUNDAY}),
        ("shopping-list", {"week_start": SUNDAY}),
        ("generate", {"week_start": SUNDAY}),
    ],
)
def test_agent_error_is_502_with_safe_message(auth_client, fake, path, json):
    put_meal(auth_client, SUNDAY, "dinner")
    fake.error = AgentError("The meal assistant is unavailable right now. Please try again.")
    r = auth_client.post(f"/api/meals/{path}", json=json)
    assert r.status_code == 502
    assert r.json() == {"detail": "The meal assistant is unavailable right now. Please try again."}


def test_generate_only_saves_requested_slots(auth_client, fake):
    put_meal(auth_client, SUNDAY, "lunch", name="Mine")
    real = fake.generate_meals
    fake.generate_meals = lambda have, prefs, size, slots: real(have, prefs, size, list(Slot))  # ignores slots
    saved = auth_client.post(
        "/api/meals/generate", json={"week_start": SUNDAY, "slots": ["dinner"], "overwrite": True}
    ).json()
    assert {m["slot"] for m in saved} == {"dinner"}
    lunches = [m for m in auth_client.get("/api/meals?month=2026-10").json() if m["slot"] == "lunch"]
    assert [m["name"] for m in lunches] == ["Mine"]


def test_default_agents_dependency_is_the_agents_module():
    from app import agents

    assert get_agents() is agents


# ---- linked accounts share one plan ----


def test_linked_users_share_one_meal_plan(make_user, client_for, db):
    ann, bob, cat = make_user(), make_user(), make_user()
    put_meal(client_for(bob), SUNDAY, "lunch", name="Bob's lunch")
    put_meal(client_for(bob), SUNDAY, "dinner", name="Bob's dinner")
    put_meal(client_for(ann), SUNDAY, "dinner", name="Ann's dinner")
    link(db, bob, ann)
    link(db, ann, cat, "pending")
    a, b, c = client_for(ann), client_for(bob), client_for(cat)
    assert names(a) == names(b) == ["Bob's lunch", "Ann's dinner"]  # merged; the latest row wins a clash
    put_meal(a, SUNDAY, "dinner", name="Ann's pick")
    assert names(b) == ["Bob's lunch", "Ann's pick"]
    assert names(c) == []  # pending link
    assert b.delete(f"/api/meals/{SUNDAY}/dinner").status_code == 204
    assert names(a) == ["Bob's lunch"]
    put_meal(a, SUNDAY, "snack", name="Ann's snack")
    db.query(Link).delete()
    db.flush()
    assert names(a) == ["Ann's snack"]  # unlinking leaves each with the meals they wrote
    assert names(b) == ["Bob's lunch"]


def test_sharing_follows_direct_links_only(make_user, client_for, db):
    ann, bob, cat = make_user(), make_user(), make_user()
    link(db, ann, bob)
    link(db, cat, bob)
    put_meal(client_for(cat), SUNDAY, "dinner", name="Cat's pick")
    put_meal(client_for(ann), SUNDAY, "lunch", name="Ann's pick")
    assert names(client_for(bob)) == ["Ann's pick", "Cat's pick"]
    assert names(client_for(ann)) == ["Ann's pick"]
    assert names(client_for(cat)) == ["Cat's pick"]


def test_linked_users_share_the_pantry(make_user, client_for, db):
    ann, bob, dan = make_user(), make_user(), make_user()
    client_for(ann).put("/api/pantry", json={"items": [{"name": "Eggs", "quantity": 6.0, "unit": ""}]})
    link(db, ann, bob)
    a, b = client_for(ann), client_for(bob)
    milk = [{"name": "Milk", "quantity": 1.0, "unit": "l"}]
    assert b.get("/api/pantry").json() == {"items": [{"name": "Eggs", "quantity": 6.0, "unit": ""}]}
    b.put("/api/pantry", json={"items": milk})  # replaces the whole shared pantry
    assert a.get("/api/pantry").json() == b.get("/api/pantry").json() == {"items": milk}
    assert client_for(dan).get("/api/pantry").json() == {"items": []}


def test_generate_uses_every_members_preferences(make_user, client_for, db, fake):
    ann = make_user(household_size=1, preferences={"diet": "vegan"})
    bob = make_user(household_size=3, preferences={"allergies": ["peanuts"]})
    link(db, ann, bob)
    client_for(ann).put("/api/pantry", json={"items": [{"name": "Rice", "quantity": 1, "unit": "kg"}]})
    put_meal(client_for(ann), SUNDAY, "dinner", name="Kept")
    r = client_for(bob).post("/api/meals/generate", json={"week_start": SUNDAY, "slots": ["dinner"]})
    assert r.status_code == 200 and len(r.json()) == 6
    have, prefs, size, _ = fake.calls["generate_meals"]
    assert have == [GroceryItem(name="Rice", quantity=1, unit="kg")]
    assert [(p.diet, p.allergies) for p in prefs] == [("vegan", []), ("none", ["peanuts"])]
    assert size == 3
    assert len(names(client_for(ann))) == 7 and "Kept" in names(client_for(ann))


def test_shopping_list_uses_household_size_and_pantry(make_user, client_for, db, fake):
    ann, bob = make_user(), make_user()  # both default to household_size 1
    link(db, ann, bob)
    put_meal(client_for(ann), SUNDAY, "dinner")
    client_for(ann).put("/api/pantry", json={"items": [{"name": "Rice", "quantity": 1, "unit": "kg"}]})
    b = client_for(bob)
    b.post("/api/meals/shopping-list", json={"week_start": SUNDAY})
    assert fake.calls["groceries_needed"][1] == 2  # at least one serving per member
    assert fake.calls["shopping_list"][1] == [GroceryItem(name="Rice", quantity=1, unit="kg")]
    ann.household_size = 4
    db.flush()
    b.post("/api/meals/shopping-list", json={"week_start": SUNDAY})
    assert fake.calls["groceries_needed"][1] == 4  # the partner's size counts too


def test_generate_pantry_settles_the_shared_pantry(make_user, client_for, db, fake):
    ann, bob = make_user(), make_user()
    link(db, ann, bob)
    put_meal(client_for(ann), SUNDAY, "dinner")
    client_for(ann).put("/api/pantry", json={"items": [{"name": "Spaghetti", "quantity": 300, "unit": "g"}]})
    r = client_for(bob).post("/api/pantry/generate", json={"week_start": SUNDAY})
    expected = {"items": [{"name": "Spaghetti", "quantity": 50.0, "unit": "g"}]}
    assert r.status_code == 200 and r.json() == expected
    assert client_for(ann).get("/api/pantry").json() == expected
    assert fake.calls["groceries_needed"][1] == 2


def test_shopping_list_is_saved_with_its_week(make_user, client_for, db, fake):
    ann, bob = make_user(), make_user()
    link(db, ann, bob)
    a = client_for(ann)
    put_meal(a, SUNDAY, "dinner")
    url = f"/api/meals/shopping-list?week_start={SUNDAY}"
    assert a.get(url).json() is None
    built = a.post("/api/meals/shopping-list", json={"week_start": SUNDAY}).json()
    assert a.get(url).json() == built
    assert client_for(bob).get(url).json() == built  # the household shares it
    assert a.get("/api/meals/shopping-list?week_start=2026-10-11").json() is None
    client_for(bob).post("/api/meals/shopping-list", json={"week_start": SUNDAY})  # a rebuild replaces it
    assert db.scalar(select(func.count()).select_from(ShoppingListRow)) == 1
    fake.error = AgentError("down")
    a.post("/api/meals/shopping-list", json={"week_start": SUNDAY})
    assert a.get(url).json() == built  # a failed rebuild keeps the saved list
    assert client_for(make_user()).get(url).json() is None
