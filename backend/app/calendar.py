import calendar as cal
import datetime as dt
from collections.abc import Sequence
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import ForeignKey, SmallInteger, String, Text, and_, or_, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from app.accounts import linked_user_ids
from app.auth import DB, CurrentUser, User
from app.db import Base

Recurrence = Literal["none", "daily", "weekly", "biweekly", "monthly"]


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    date: Mapped[dt.date]
    start_time: Mapped[dt.time | None]
    notes: Mapped[str] = mapped_column(Text, default="")
    shared: Mapped[bool] = mapped_column(default=False)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    date: Mapped[dt.date]
    notes: Mapped[str] = mapped_column(Text, default="")
    shared: Mapped[bool] = mapped_column(default=False)
    done: Mapped[bool] = mapped_column(default=False)


class Chore(Base):
    __tablename__ = "chores"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    assignee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[date]
    recurrence: Mapped[Recurrence] = mapped_column(String(10))
    weekdays: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), default=list, server_default="{}")
    end_date: Mapped[date | None]
    shared: Mapped[bool] = mapped_column(default=False)
    assignee: Mapped[User] = relationship(foreign_keys=[assignee_id], lazy="joined")


class ChoreCompletion(Base):
    __tablename__ = "chore_completions"
    chore_id: Mapped[int] = mapped_column(ForeignKey("chores.id", ondelete="CASCADE"), primary_key=True)
    date: Mapped[dt.date] = mapped_column(primary_key=True)


def occurrences(
    start: date, recurrence: Recurrence, end: date | None, range_start: date, range_end: date, weekdays: Sequence[int] = ()
) -> list[date]:
    """Dates (inclusive range) on which a chore falls. Monthly keeps the start's day, clamped to short months.
    Weekly/biweekly fall on `weekdays` (Mon=0), or the start's weekday if empty, counting weeks from the start's week."""
    last = min(range_end, end) if end else range_end
    if recurrence == "none":
        return [start] if range_start <= start <= last else []
    out = []
    if recurrence == "monthly":
        n = max(0, (range_start.year - start.year) * 12 + range_start.month - start.month)
        while True:
            y, m = divmod(start.month - 1 + n, 12)
            y += start.year
            if y > date.max.year:
                return out
            d = date(y, m + 1, min(start.day, cal.monthrange(y, m + 1)[1]))
            if d > last:
                return out
            if d >= range_start:
                out.append(d)
            n += 1
    # Ordinals, not date arithmetic, so stepping past 9999-12-31 can't overflow.
    days = range(max(start, range_start).toordinal(), last.toordinal() + 1)
    if recurrence == "daily":
        return [date.fromordinal(o) for o in days]
    on, weeks = set(weekdays) or {start.weekday()}, 1 if recurrence == "weekly" else 2
    monday = start.toordinal() - start.weekday()
    return [date.fromordinal(o) for o in days if (o - monday) % 7 in on and (o - monday) // 7 % weeks == 0]


# ---- schemas ----

Title = Annotated[str, Field(min_length=1, max_length=200)]


class EventIn(BaseModel):
    title: Title
    date: dt.date
    start_time: dt.time | None = None
    notes: str = ""
    shared: bool = False


class EventOut(EventIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int


class TaskIn(BaseModel):
    title: Title
    date: dt.date
    notes: str = ""
    shared: bool = False


class TaskOut(TaskIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    done: bool


class ChoreIn(BaseModel):
    title: Title
    assignee_id: int
    start_date: date
    recurrence: Recurrence
    weekdays: list[Annotated[int, Field(ge=0, le=6)]] = []
    end_date: date | None = None
    notes: str = ""
    shared: bool = False

    @model_validator(mode="after")
    def _check(self):
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("End date must be on or after the start date")
        self.weekdays = sorted(set(self.weekdays)) if self.recurrence in ("weekly", "biweekly") else []
        return self


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    avatar: str | None


class ChoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    title: str
    notes: str
    start_date: date
    recurrence: Recurrence
    weekdays: list[int]
    end_date: date | None
    shared: bool
    assignee: Person


class Occurrence(BaseModel):
    chore_id: int
    title: str
    date: dt.date
    assignee_id: int
    owner_id: int
    done: bool


class MonthOut(BaseModel):
    events: list[EventOut]
    tasks: list[TaskOut]
    chores: list[Occurrence]
    people: list[Person]  # the chores' assignees, once each: avatars are large data URLs


# ---- helpers ----

def _my_event(db: Session, event_id: int, user: User) -> Event:
    ev = db.get(Event, event_id)
    if ev is None or ev.owner_id != user.id:
        raise HTTPException(404, "Event not found")
    return ev


def _visible_task(db: Session, task_id: int, user: User, *, owner_only: bool = False) -> Task:
    t = db.get(Task, task_id)
    if t is None or not (t.owner_id == user.id or (not owner_only and t.shared and t.owner_id in linked_user_ids(db, user))):
        raise HTTPException(404, "Task not found")
    return t


def _visible_chore(db: Session, chore_id: int, user: User, *, owner_only: bool = False) -> Chore:
    ch = db.get(Chore, chore_id)
    visible = ch is not None and (
        ch.owner_id == user.id
        or (not owner_only and (ch.assignee_id == user.id or ch.shared) and ch.owner_id in linked_user_ids(db, user))
    )
    if not visible:
        raise HTTPException(404, "Chore not found")
    return ch


def _check_assignee(db: Session, user: User, assignee_id: int) -> None:
    if assignee_id != user.id and assignee_id not in linked_user_ids(db, user):
        raise HTTPException(400, "Chores can only be assigned to you or a linked account")


def _occurrences(db: Session, chores: list[Chore], start: date, end: date) -> list[Occurrence]:
    done = set(
        db.execute(
            select(ChoreCompletion.chore_id, ChoreCompletion.date).where(
                ChoreCompletion.chore_id.in_([c.id for c in chores]), ChoreCompletion.date.between(start, end)
            )
        )
    )
    out = [
        Occurrence(
            chore_id=c.id, title=c.title, date=d, assignee_id=c.assignee_id, owner_id=c.owner_id, done=(c.id, d) in done
        )
        for c in chores
        for d in occurrences(c.start_date, c.recurrence, c.end_date, start, end, c.weekdays)
    ]
    return sorted(out, key=lambda o: o.date)


def _chores_of(db: Session, user: User, *, assigned_only: bool = False) -> list[Chore]:
    """Chores I own, am assigned, or that are shared with me. Someone else's chore counts only while we're linked."""
    linked = Chore.owner_id.in_(linked_user_ids(db, user))
    who = and_(Chore.assignee_id == user.id, or_(Chore.owner_id == user.id, linked))
    if not assigned_only:
        who = or_(who, Chore.owner_id == user.id, and_(Chore.shared, linked))
    return list(db.scalars(select(Chore).where(who).order_by(Chore.id)))


# ---- routes ----

router = APIRouter(prefix="/api", tags=["calendar"])
Month = Annotated[str, Path(pattern=r"^[1-9]\d{3}-(0[1-9]|1[0-2])$")]


@router.get("/calendar/{month}", response_model=MonthOut)
def month_view(month: Month, user: CurrentUser, db: DB):
    y, m = map(int, month.split("-"))
    start, end = date(y, m, 1), date(y, m, cal.monthrange(y, m)[1])
    linked = linked_user_ids(db, user)
    events = db.scalars(
        select(Event)
        .where(
            Event.date.between(start, end),
            or_(Event.owner_id == user.id, and_(Event.shared, Event.owner_id.in_(linked))),
        )
        .order_by(Event.date, Event.start_time.nulls_first(), Event.id)
    )
    tasks = db.scalars(
        select(Task)
        .where(Task.date.between(start, end), or_(Task.owner_id == user.id, and_(Task.shared, Task.owner_id.in_(linked))))
        .order_by(Task.date, Task.id)
    )
    chores = _chores_of(db, user)
    people = list({c.assignee_id: c.assignee for c in chores}.values())
    return MonthOut(events=list(events), tasks=list(tasks), chores=_occurrences(db, chores, start, end), people=people)


@router.post("/events", status_code=201, response_model=EventOut)
def create_event(body: EventIn, user: CurrentUser, db: DB):
    ev = Event(owner_id=user.id, **body.model_dump())
    db.add(ev)
    db.commit()
    return ev


@router.put("/events/{event_id}", response_model=EventOut)
def update_event(event_id: int, body: EventIn, user: CurrentUser, db: DB):
    ev = _my_event(db, event_id, user)
    for k, v in body.model_dump().items():
        setattr(ev, k, v)
    db.commit()
    return ev


@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: int, user: CurrentUser, db: DB):
    db.delete(_my_event(db, event_id, user))
    db.commit()


@router.post("/tasks", status_code=201, response_model=TaskOut)
def create_task(body: TaskIn, user: CurrentUser, db: DB):
    t = Task(owner_id=user.id, **body.model_dump())
    db.add(t)
    db.commit()
    return t


@router.put("/tasks/{task_id}", response_model=TaskOut)
def update_task(task_id: int, body: TaskIn, user: CurrentUser, db: DB):
    t = _visible_task(db, task_id, user, owner_only=True)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    db.commit()
    return t


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, user: CurrentUser, db: DB):
    db.delete(_visible_task(db, task_id, user, owner_only=True))
    db.commit()


@router.post("/tasks/{task_id}/done", status_code=204)
def task_done(task_id: int, user: CurrentUser, db: DB):
    _visible_task(db, task_id, user).done = True
    db.commit()


@router.delete("/tasks/{task_id}/done", status_code=204)
def task_undone(task_id: int, user: CurrentUser, db: DB):
    _visible_task(db, task_id, user).done = False
    db.commit()


@router.get("/chores", response_model=list[ChoreOut])
def list_chores(user: CurrentUser, db: DB):
    return _chores_of(db, user)


@router.get("/chores/today", response_model=list[Occurrence])
def today_chores(date: dt.date, user: CurrentUser, db: DB):
    return _occurrences(db, _chores_of(db, user, assigned_only=True), date, date)


@router.post("/chores", status_code=201, response_model=ChoreOut)
def create_chore(body: ChoreIn, user: CurrentUser, db: DB):
    _check_assignee(db, user, body.assignee_id)
    ch = Chore(owner_id=user.id, **body.model_dump())
    db.add(ch)
    db.commit()
    return ch


@router.put("/chores/{chore_id}", response_model=ChoreOut)
def update_chore(chore_id: int, body: ChoreIn, user: CurrentUser, db: DB):
    ch = _visible_chore(db, chore_id, user, owner_only=True)
    if body.assignee_id != ch.assignee_id:  # keeping an assignee who has since been unlinked is allowed
        _check_assignee(db, user, body.assignee_id)
    for k, v in body.model_dump().items():
        setattr(ch, k, v)
    db.commit()
    db.refresh(ch)
    return ch


@router.delete("/chores/{chore_id}", status_code=204)
def delete_chore(chore_id: int, user: CurrentUser, db: DB):
    db.delete(_visible_chore(db, chore_id, user, owner_only=True))
    db.commit()


def _occurrence_chore(db: Session, chore_id: int, day: date, user: User) -> Chore:
    ch = _visible_chore(db, chore_id, user)
    if not occurrences(ch.start_date, ch.recurrence, ch.end_date, day, day, ch.weekdays):
        raise HTTPException(400, "The chore isn't due on that date")
    return ch


@router.post("/chores/{chore_id}/done/{day}", status_code=204)
def mark_done(chore_id: int, day: date, user: CurrentUser, db: DB):
    _occurrence_chore(db, chore_id, day, user)
    if db.get(ChoreCompletion, (chore_id, day)) is None:
        db.add(ChoreCompletion(chore_id=chore_id, date=day))
        db.commit()


@router.delete("/chores/{chore_id}/done/{day}", status_code=204)
def mark_undone(chore_id: int, day: date, user: CurrentUser, db: DB):
    _occurrence_chore(db, chore_id, day, user)
    if done := db.get(ChoreCompletion, (chore_id, day)):
        db.delete(done)
        db.commit()
