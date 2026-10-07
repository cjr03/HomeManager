import os
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Annotated

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pwdlib import PasswordHash
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from sqlalchemy import Index, String, Text, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.db import Base, get_db

# Dev fallback only; set JWT_SECRET in any real deployment.
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-insecure-secret-change-me-0123456789")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "").lower() in ("1", "true")
SESSION_DAYS = 7

_hasher = PasswordHash.recommended()
_DUMMY_HASH = _hasher.hash("timing-equaliser")


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    username: Mapped[str] = mapped_column(String(32))
    password_hash: Mapped[str]
    household_size: Mapped[int] = mapped_column(default=1)
    preferences: Mapped[dict] = mapped_column(JSONB, default=dict)
    avatar: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


Index("uq_users_username_lower", func.lower(User.username), unique=True)


class Diet(StrEnum):
    none = "none"
    vegetarian = "vegetarian"
    vegan = "vegan"
    pescatarian = "pescatarian"
    keto = "keto"
    paleo = "paleo"
    gluten_free = "gluten_free"


class CookingTime(StrEnum):
    quick = "quick"
    moderate = "moderate"
    elaborate = "elaborate"


class BudgetLevel(StrEnum):
    thrifty = "thrifty"
    moderate = "moderate"
    generous = "generous"


class Preferences(BaseModel):
    diet: Diet = Diet.none
    allergies: list[str] = []
    dislikes: str = ""
    favorite_cuisines: list[str] = []
    cooking_time: CookingTime = CookingTime.moderate
    budget_level: BudgetLevel = BudgetLevel.moderate


HouseholdSize = Annotated[int, Field(ge=1, le=20)]
Password = Annotated[str, Field(min_length=8, max_length=128)]


class ProfileIn(BaseModel):
    household_size: HouseholdSize = 1
    preferences: Preferences = Preferences()


class SignupIn(ProfileIn):
    email: EmailStr
    username: Annotated[str, Field(pattern=r"^[A-Za-z0-9_]{3,32}$")]
    password: Password
    password_confirm: str

    @field_validator("email")
    @classmethod
    def _lower_email(cls, v: str) -> str:
        return v.lower()

    @model_validator(mode="after")
    def _passwords_match(self):
        if self.password != self.password_confirm:
            raise ValueError("Passwords do not match")
        return self


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    username: str
    household_size: int
    preferences: Preferences
    avatar: str | None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return _hasher.verify(password, hashed)


def create_token(user_id: int) -> str:
    exp = datetime.now(UTC) + timedelta(days=SESSION_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": exp}, JWT_SECRET, algorithm="HS256")


def get_current_user(session: Annotated[str | None, Cookie()] = None, db: Session = Depends(get_db)) -> User:
    try:
        user_id = int(jwt.decode(session or "", JWT_SECRET, algorithms=["HS256"])["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise HTTPException(401, "Not authenticated")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(401, "Not authenticated")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[Session, Depends(get_db)]


def find_user(db: Session, username: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.username) == username.lower()))


def _set_session(response: Response, user: User) -> None:
    response.set_cookie(
        "session",
        create_token(user.id),
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
    )


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", status_code=201, response_model=UserOut)
def signup(body: SignupIn, response: Response, db: DB):
    if find_user(db, body.username):
        raise HTTPException(409, "Username already taken")
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(409, "Email already registered")
    user = User(
        email=body.email,
        username=body.username,
        password_hash=hash_password(body.password),
        household_size=body.household_size,
        preferences=body.preferences.model_dump(mode="json"),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as e:  # lost a race with a concurrent signup
        db.rollback()
        taken = e.orig.diag.constraint_name == "uq_users_username_lower"
        raise HTTPException(409, "Username already taken" if taken else "Email already registered")
    _set_session(response, user)
    return user


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: DB):
    user = find_user(db, body.username)
    # Verify against a dummy hash for unknown users so timing doesn't reveal which usernames exist.
    if not verify_password(body.password, user.password_hash if user else _DUMMY_HASH) or user is None:
        raise HTTPException(401, "Invalid username or password")
    _set_session(response, user)
    return user


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie("session", httponly=True, samesite="lax", secure=COOKIE_SECURE)
