from collections import defaultdict
from collections.abc import Iterable
from decimal import Decimal
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import ForeignKey, Index, Numeric, String, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.accounts import linked_user_ids
from app.auth import DB, CurrentUser, User
from app.db import Base


class Kind(StrEnum):
    asset = "asset"  # a = value
    debit = "debit"  # a = balance on day 1, b = balance on last day
    income = "income"  # a = pre-tax, b = post-tax
    loan = "loan"  # a = amount owed
    credit = "credit"  # a = balance on day 1, b = balance on last day
    expense = "expense"  # a = budgeted, b = actual
    savings = "savings"  # a = budgeted, b = actual


BALANCES = {Kind.debit, Kind.credit}  # the only kinds whose amounts may be negative


class BudgetLine(Base):
    __tablename__ = "budget_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    month: Mapped[str] = mapped_column(String(7))
    kind: Mapped[str] = mapped_column(String(8))
    name: Mapped[str] = mapped_column(String(100))
    a: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    b: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    position: Mapped[int] = mapped_column(default=0)


Index("ix_budget_lines_user_month", BudgetLine.user_id, BudgetLine.month)


# ---- summary ----

class Balances(BaseModel):
    start: Decimal = Field(description="Sum of balances on day 1 of the month.")
    end: Decimal = Field(description="Sum of balances on the last day of the month (missing = 0).")
    difference: Decimal = Field(description="end - start: positive means the balance grew.")


class Income(BaseModel):
    pre_tax: Decimal
    post_tax: Decimal = Field(description="Missing post-tax amounts count as 0.")


class Plan(BaseModel):
    budgeted: Decimal
    actual: Decimal = Field(description="Missing actual amounts count as 0.")
    difference: Decimal = Field(description="Positive is always good; see the field on BudgetSummary for the formula.")


class BudgetSummary(BaseModel):
    assets: Decimal = Field(description="Total value of assets.")
    debit: Balances = Field(description="Debit accounts. difference = end - start (positive = more money).")
    income: Income
    loans: Decimal = Field(description="Total owed on loans.")
    credit: Balances = Field(description="Credit accounts. difference = end - start (positive = more debt).")
    expenses: Plan = Field(description="difference = budgeted - actual (positive = under budget).")
    savings: Plan = Field(description="difference = actual - budgeted (positive = saved more than planned).")
    remainder: Plan = Field(
        description="Post-tax income minus expenses and savings. budgeted uses budgeted amounts, actual uses actuals; "
        "difference = actual - budgeted (positive = more left over than planned)."
    )
    net_worth: Decimal = Field(description="assets + debit end - loans - credit end.")


def summarize(lines: Iterable[BudgetLine]) -> BudgetSummary:
    a: defaultdict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    b: defaultdict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for line in lines:
        a[line.kind] += line.a
        b[line.kind] += line.b or 0

    def plan(kind: str, sign: int) -> Plan:
        return Plan(budgeted=a[kind], actual=b[kind], difference=sign * (a[kind] - b[kind]))

    def balances(kind: str) -> Balances:
        return Balances(start=a[kind], end=b[kind], difference=b[kind] - a[kind])

    left_budgeted = b[Kind.income] - a[Kind.expense] - a[Kind.savings]
    left_actual = b[Kind.income] - b[Kind.expense] - b[Kind.savings]
    return BudgetSummary(
        assets=a[Kind.asset],
        debit=balances(Kind.debit),
        income=Income(pre_tax=a[Kind.income], post_tax=b[Kind.income]),
        loans=a[Kind.loan],
        credit=balances(Kind.credit),
        expenses=plan(Kind.expense, 1),
        savings=plan(Kind.savings, -1),
        remainder=Plan(budgeted=left_budgeted, actual=left_actual, difference=left_actual - left_budgeted),
        net_worth=a[Kind.asset] + b[Kind.debit] - a[Kind.loan] - b[Kind.credit],
    )


# ---- schemas ----

Month = Annotated[str, Path(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]
Amount = Annotated[Decimal, Field(max_digits=12, decimal_places=2)]


class LineUpdate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    a: Amount
    b: Amount | None = None


class LineIn(LineUpdate):
    kind: Kind


class LineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int = Field(validation_alias="user_id")
    month: str
    kind: Kind
    name: str
    a: Decimal
    b: Decimal | None
    position: int


class MonthOut(BaseModel):
    lines: list[LineOut]
    summary: BudgetSummary


class Member(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    avatar: str | None


class MemberSummary(BaseModel):
    user_id: int
    summary: BudgetSummary


class SharedOut(MonthOut):
    members: list[Member]
    per_member: list[MemberSummary]


# ---- routes ----

def _check_amounts(kind: str, body: LineUpdate) -> None:
    if kind not in BALANCES and (body.a < 0 or (body.b or 0) < 0):
        raise HTTPException(422, "Amounts must be zero or more")


def _lines(db: Session, user_ids: list[int], month: str) -> list[BudgetLine]:
    q = select(BudgetLine).where(BudgetLine.user_id.in_(user_ids), BudgetLine.month == month)
    return list(db.scalars(q.order_by(BudgetLine.position, BudgetLine.id)))


def _month_out(db: Session, user: User, month: str) -> MonthOut:
    lines = _lines(db, [user.id], month)
    return MonthOut(lines=lines, summary=summarize(lines))


def _own_line(db: Session, line_id: int, user: User) -> BudgetLine:
    line = db.get(BudgetLine, line_id)
    if line is None or line.user_id != user.id:
        raise HTTPException(404, "Line not found")
    return line


def _previous(month: str) -> str:
    y, m = map(int, month.split("-"))
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


router = APIRouter(prefix="/api/budget", tags=["budget"])


@router.get("/{month}", response_model=MonthOut)
def get_month(month: Month, user: CurrentUser, db: DB):
    return _month_out(db, user, month)


@router.post("/{month}/lines", status_code=201, response_model=LineOut)
def create_line(month: Month, body: LineIn, user: CurrentUser, db: DB):
    _check_amounts(body.kind, body)
    count = db.scalar(select(func.count()).where(BudgetLine.user_id == user.id, BudgetLine.month == month))
    line = BudgetLine(user_id=user.id, month=month, position=count, **body.model_dump())
    db.add(line)
    db.commit()
    return line


@router.patch("/lines/{line_id}", response_model=LineOut)
def update_line(line_id: int, body: LineUpdate, user: CurrentUser, db: DB):
    line = _own_line(db, line_id, user)
    _check_amounts(line.kind, body)
    line.name, line.a, line.b = body.name, body.a, body.b
    db.commit()
    return line


@router.delete("/lines/{line_id}", status_code=204)
def delete_line(line_id: int, user: CurrentUser, db: DB):
    db.delete(_own_line(db, line_id, user))
    db.commit()


@router.post("/{month}/copy-previous", status_code=201, response_model=MonthOut)
def copy_previous(month: Month, user: CurrentUser, db: DB):
    if _lines(db, [user.id], month):
        raise HTTPException(409, "This month already has lines")
    source = _lines(db, [user.id], _previous(month))
    if not source:
        raise HTTPException(404, "Last month has nothing to copy")
    db.add_all(
        BudgetLine(user_id=user.id, month=month, kind=s.kind, name=s.name, a=s.a, b=s.b, position=s.position)
        for s in source
    )
    db.commit()
    return _month_out(db, user, month)


@router.get("/{month}/shared/{other_user_id}", response_model=SharedOut)
def get_shared(month: Month, other_user_id: int, user: CurrentUser, db: DB):
    if other_user_id not in linked_user_ids(db, user):
        raise HTTPException(404, "No linked account with that id")
    members = [user, db.get(User, other_user_id)]
    lines = _lines(db, [m.id for m in members], month)
    return SharedOut(
        members=members,
        lines=lines,
        summary=summarize(lines),
        per_member=[
            MemberSummary(user_id=m.id, summary=summarize(x for x in lines if x.user_id == m.id)) for m in members
        ],
    )
