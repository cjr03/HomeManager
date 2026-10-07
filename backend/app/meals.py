"""Meal plan entries, the pantry, and the three meal agents behind HTTP."""

from datetime import date, timedelta
from decimal import Decimal
from itertools import groupby
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, field_validator
from sqlalchemy import CheckConstraint, ForeignKey, Numeric, String, UniqueConstraint, delete, select
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.orm import Mapped, Session, mapped_column

from app import agents
from app.agents import WEEKDAYS, AgentError, DayPlan, GroceryItem, GroceryList, PlannedMeal, ShoppingList, Slot
from app.auth import DB, CurrentUser, Preferences, User
from app.db import Base


class MealEntry(Base):
    __tablename__ = "meal_entries"
    __table_args__ = (UniqueConstraint("user_id", "date", "slot"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    date: Mapped[date]
    slot: Mapped[str] = mapped_column(String(9))
    name: Mapped[str] = mapped_column(String(200))
    servings: Mapped[int | None]
    ingredients: Mapped[list | None] = mapped_column(JSONB(none_as_null=True))
    instructions: Mapped[list | None] = mapped_column(JSONB(none_as_null=True))


class PantryItem(Base):
    __tablename__ = "pantry_items"
    __table_args__ = (CheckConstraint("quantity > 0"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[Decimal] = mapped_column(Numeric)
    unit: Mapped[str] = mapped_column(String(20))


def week_dates(week_start: date) -> list[date]:
    return [week_start + timedelta(days=i) for i in range(7)]


def _by_day(e: MealEntry):
    return e.date, list(Slot).index(Slot(e.slot))


def pantry_remainder(have: list[GroceryItem], bought: list[GroceryItem], used: list[GroceryItem]) -> list[GroceryItem]:
    """have + bought - used, matched by name and unit ignoring case; anything used up is dropped."""
    # ponytail: exact name/unit match, while the shopping agent matches by meaning ("pasta" covers
    # "spaghetti", 1 kg covers 500 g). Mismatched spellings or units don't come off; an agent step if that bites.
    left: dict[tuple[str, str], list] = {}
    for sign, items in ((1, have), (1, bought), (-1, used)):
        for i in items:
            row = left.setdefault((i.name.strip().lower(), i.unit.strip().lower()), [i.name, i.unit, 0.0])
            row[2] += sign * i.quantity
    # Rounded so float noise (0.1 + 0.2) neither shows nor keeps a used-up item alive.
    return [GroceryItem(name=n, quantity=round(q, 3), unit=u) for n, u, q in left.values() if round(q, 3) > 0]


def day_plans(entries: list[MealEntry]) -> list[DayPlan]:
    """Entries -> one DayPlan per day that has meals, in date order, slots in Slot order."""
    entries = sorted(entries, key=_by_day)
    return [
        DayPlan(weekday=WEEKDAYS[day.weekday()], meals=[PlannedMeal(slot=e.slot, name=e.name) for e in group])
        for day, group in groupby(entries, key=lambda e: e.date)
    ]


class MealIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    servings: Annotated[int, Field(ge=1)] | None = None
    ingredients: list[GroceryItem] | None = None
    instructions: list[str] | None = None


class MealOut(MealIn):
    model_config = ConfigDict(from_attributes=True)

    date: date
    slot: Slot


class WeekIn(BaseModel):
    week_start: date

    @field_validator("week_start")
    @classmethod
    def _sunday(cls, v: date) -> date:
        if v.weekday() != 6:
            raise ValueError("week_start must be a Sunday")
        return v


class PantryItemIn(GroceryItem):
    """GroceryItem with the pantry_items column limits."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    unit: Annotated[str, StringConstraints(max_length=20)] = ""


class PantryIn(BaseModel):
    items: list[PantryItemIn]


class GenerateIn(WeekIn):
    slots: Annotated[list[Slot], Field(min_length=1)] = list(Slot)
    overwrite: bool = False


class ShoppingOut(BaseModel):
    needed: GroceryList
    shopping: ShoppingList


def get_agents():
    """The agent functions; tests override this dependency with fakes."""
    return agents


Agents = Annotated[object, Depends(get_agents)]

router = APIRouter(prefix="/api", tags=["meals"])


def _entries(db: Session, user: User, start: date, end: date) -> list[MealEntry]:
    return list(
        db.scalars(
            select(MealEntry)
            .where(MealEntry.user_id == user.id, MealEntry.date >= start, MealEntry.date < end)
            .order_by(MealEntry.date, MealEntry.id)
        )
    )


def _upsert(db: Session, user: User, day: date, slot: Slot, meal: MealIn) -> MealEntry:
    values = meal.model_dump(mode="json")
    stmt = (
        insert(MealEntry)
        .values(user_id=user.id, date=day, slot=slot, **values)
        .on_conflict_do_update(index_elements=["user_id", "date", "slot"], set_=values)
        .returning(MealEntry)
    )
    return db.scalars(stmt, execution_options={"populate_existing": True}).one()


def _pantry(db: Session, user: User) -> list[GroceryItem]:
    rows = db.scalars(select(PantryItem).where(PantryItem.user_id == user.id).order_by(PantryItem.id))
    return [GroceryItem(name=r.name, quantity=r.quantity, unit=r.unit) for r in rows]


def _save_pantry(db: Session, user: User, items: list[GroceryItem]) -> GroceryList:
    db.execute(delete(PantryItem).where(PantryItem.user_id == user.id))
    db.add_all(PantryItem(user_id=user.id, **i.model_dump()) for i in items)
    db.commit()
    return GroceryList(items=_pantry(db, user))


def _shopping(user: User, ag, plans: list[DayPlan], have: list[GroceryItem]) -> ShoppingOut:
    needed = _ask(ag.groceries_needed, plans, user.household_size)
    return ShoppingOut(needed=needed, shopping=_ask(ag.shopping_list, needed, have))


def _week_plans(db: Session, user: User, week_start: date, empty="Add some meals to this week first") -> list[DayPlan]:
    plans = day_plans(_entries(db, user, week_start, week_start + timedelta(days=7)))
    if not plans:
        raise HTTPException(400, empty)
    return plans


def _ask(call, *args):
    try:
        return call(*args)
    except AgentError as e:
        raise HTTPException(502, str(e))


@router.get("/meals", response_model=list[MealOut])
def list_meals(month: Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")], user: CurrentUser, db: DB):
    start = date.fromisoformat(f"{month}-01")
    end = (start + timedelta(days=31)).replace(day=1)
    return _entries(db, user, start, end)


@router.put("/meals/{day}/{slot}", response_model=MealOut)
def put_meal(day: date, slot: Slot, body: MealIn, user: CurrentUser, db: DB):
    entry = _upsert(db, user, day, slot, body)
    db.commit()
    return entry


@router.delete("/meals/{day}/{slot}", status_code=204)
def delete_meal(day: date, slot: Slot, user: CurrentUser, db: DB):
    db.execute(delete(MealEntry).where(MealEntry.user_id == user.id, MealEntry.date == day, MealEntry.slot == slot))
    db.commit()


@router.get("/pantry", response_model=GroceryList)
def get_pantry(user: CurrentUser, db: DB):
    return GroceryList(items=_pantry(db, user))


@router.put("/pantry", response_model=GroceryList)
def put_pantry(body: PantryIn, user: CurrentUser, db: DB):
    return _save_pantry(db, user, body.items)


@router.post("/pantry/generate", response_model=GroceryList)
def generate_pantry(body: WeekIn, user: CurrentUser, db: DB, ag: Agents):
    """Last week's pantry plus its shopping list, minus the groceries its meals used."""
    plans = _week_plans(db, user, body.week_start, "No meals were planned last week")
    have = _pantry(db, user)
    week = _shopping(user, ag, plans, have)
    remainder = pantry_remainder(have, week.shopping.items, week.needed.items)
    try:  # agent items skip PantryItemIn's column limits until here
        items = PantryIn(items=[i.model_dump() for i in remainder]).items
    except ValidationError:
        raise HTTPException(502, "The meal assistant returned an item the pantry can't hold. Please try again.")
    return _save_pantry(db, user, items)


@router.post("/meals/groceries-needed", response_model=GroceryList)
def groceries_needed(body: WeekIn, user: CurrentUser, db: DB, ag: Agents):
    return _ask(ag.groceries_needed, _week_plans(db, user, body.week_start), user.household_size)


@router.post("/meals/shopping-list", response_model=ShoppingOut)
def shopping_list(body: WeekIn, user: CurrentUser, db: DB, ag: Agents):
    return _shopping(user, ag, _week_plans(db, user, body.week_start), _pantry(db, user))


@router.post("/meals/generate", response_model=list[MealOut])
def generate(body: GenerateIn, user: CurrentUser, db: DB, ag: Agents):
    prefs = Preferences.model_validate(user.preferences)
    week = _ask(ag.generate_meals, _pantry(db, user), prefs, user.household_size, body.slots)
    dates = {WEEKDAYS[d.weekday()]: d for d in week_dates(body.week_start)}
    filled = {(e.date, e.slot) for e in _entries(db, user, body.week_start, body.week_start + timedelta(days=7))}
    saved = [
        _upsert(db, user, dates[day.weekday], meal.slot, MealIn(**meal.model_dump()))
        for day in week.days
        for meal in day.meals
        if meal.slot in body.slots and (body.overwrite or (dates[day.weekday], meal.slot) not in filled)
    ]
    db.commit()
    return sorted(saved, key=_by_day)
