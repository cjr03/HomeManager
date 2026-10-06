from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import auth
from app.auth import (
    Preferences,
    SignupIn,
    User,
    create_token,
    get_current_user,
    hash_password,
    verify_password,
)
from tests.conftest import PASSWORD


def signup_body(**over):
    body = {
        "email": "ann@example.com",
        "username": "Ann_1",
        "password": "s3cret-pass",
        "password_confirm": "s3cret-pass",
        "household_size": 3,
        "preferences": {"diet": "vegetarian", "allergies": ["peanuts"], "favorite_cuisines": ["Thai"]},
    }
    return body | over


# ---- unit: hashing, tokens, schemas ----

def test_hash_and_verify_password():
    h = hash_password("hunter22")
    assert h != "hunter22" and h.startswith("$argon2")
    assert verify_password("hunter22", h)
    assert not verify_password("wrong", h)


def test_token_round_trip_and_expiry():
    payload = jwt.decode(create_token(42), auth.JWT_SECRET, algorithms=["HS256"])
    assert payload["sub"] == "42"
    exp = datetime.fromtimestamp(payload["exp"], UTC)
    assert timedelta(days=6, hours=23) < exp - datetime.now(UTC) <= timedelta(days=7)


def test_preferences_defaults():
    assert Preferences().model_dump(mode="json") == {
        "diet": "none",
        "allergies": [],
        "dislikes": "",
        "favorite_cuisines": [],
        "cooking_time": "moderate",
        "budget_level": "moderate",
    }


def test_preferences_rejects_unknown_enum():
    with pytest.raises(ValidationError):
        Preferences(diet="carnivore")


def test_signup_schema_password_mismatch():
    with pytest.raises(ValidationError, match="Passwords do not match"):
        SignupIn(**signup_body(password_confirm="different1"))


@pytest.mark.parametrize(
    "field,value",
    [("username", "ab"), ("username", "x" * 33), ("username", "bad name!"), ("password", "short"),
     ("household_size", 0), ("household_size", 21), ("email", "not-an-email")],
)
def test_signup_schema_field_rules(field, value):
    body = signup_body(**{field: value})
    if field == "password":
        body["password_confirm"] = value
    with pytest.raises(ValidationError):
        SignupIn(**body)


def test_signup_schema_defaults():
    s = SignupIn(email="a@b.co", username="abc", password="12345678", password_confirm="12345678")
    assert s.household_size == 1
    assert s.preferences == Preferences()


# ---- unit: get_current_user ----

def test_get_current_user_ok(db, make_user):
    user = make_user()
    assert get_current_user(create_token(user.id), db) is user


@pytest.mark.parametrize("token", [None, "", "garbage"])
def test_get_current_user_missing_or_invalid(db, token):
    with pytest.raises(HTTPException) as e:
        get_current_user(token, db)
    assert e.value.status_code == 401


def test_get_current_user_expired(db, make_user):
    user = make_user()
    token = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(UTC) - timedelta(seconds=1)}, auth.JWT_SECRET, "HS256"
    )
    with pytest.raises(HTTPException) as e:
        get_current_user(token, db)
    assert e.value.status_code == 401


def test_get_current_user_wrong_secret(db, make_user):
    user = make_user()
    token = jwt.encode({"sub": str(user.id), "exp": datetime.now(UTC) + timedelta(days=1)}, "x" * 32, "HS256")
    with pytest.raises(HTTPException):
        get_current_user(token, db)


def test_get_current_user_deleted_user(db, make_user):
    user = make_user()
    token = create_token(user.id)
    db.delete(user)
    db.flush()
    with pytest.raises(HTTPException) as e:
        get_current_user(token, db)
    assert e.value.status_code == 401


# ---- API: signup ----

def test_signup_creates_user_and_sets_cookie(client, db):
    r = client.post("/api/auth/signup", json=signup_body())
    assert r.status_code == 201
    body = r.json()
    assert body["username"] == "Ann_1" and body["email"] == "ann@example.com"
    assert body["household_size"] == 3
    assert body["preferences"]["diet"] == "vegetarian"
    assert body["avatar"] is None
    assert not any("password" in k for k in body)
    cookie = r.headers["set-cookie"]
    assert "session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert "Secure" not in cookie
    user = db.query(User).filter_by(username="Ann_1").one()
    assert verify_password("s3cret-pass", user.password_hash)
    assert client.get("/api/me").json()["username"] == "Ann_1"


def test_signup_secure_cookie_flag(client, monkeypatch):
    monkeypatch.setattr(auth, "COOKIE_SECURE", True)
    r = client.post("/api/auth/signup", json=signup_body())
    assert "Secure" in r.headers["set-cookie"]


def test_signup_password_mismatch_is_422(client):
    r = client.post("/api/auth/signup", json=signup_body(password_confirm="nope-nope"))
    assert r.status_code == 422
    assert "Passwords do not match" in r.text


def test_signup_duplicate_username_case_insensitive(client, make_user):
    make_user("ann_1")
    r = client.post("/api/auth/signup", json=signup_body())
    assert r.status_code == 409
    assert r.json()["detail"] == "Username already taken"


def test_signup_duplicate_email(client, make_user):
    make_user("someone", email="ann@example.com")
    r = client.post("/api/auth/signup", json=signup_body(email="ANN@example.com"))
    assert r.status_code == 409
    assert r.json()["detail"] == "Email already registered"


# ---- API: login / logout ----

def test_login_success_sets_cookie(client, make_user):
    make_user("bob")
    r = client.post("/api/auth/login", json={"username": "bob", "password": PASSWORD})
    assert r.status_code == 200
    assert r.json()["username"] == "bob"
    assert "session=" in r.headers["set-cookie"]
    assert client.get("/api/me").status_code == 200


def test_login_is_case_insensitive_on_username(client, make_user):
    make_user("Bob")
    assert client.post("/api/auth/login", json={"username": "bob", "password": PASSWORD}).status_code == 200


@pytest.mark.parametrize("username,password", [("bob", "wrong-pass"), ("nobody", PASSWORD)])
def test_login_failure_is_generic_401(client, make_user, username, password):
    make_user("bob")
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid username or password"
    assert "set-cookie" not in r.headers


def test_logout_clears_cookie(auth_client):
    r = auth_client.post("/api/auth/logout")
    assert r.status_code == 204
    assert "Max-Age=0" in r.headers["set-cookie"]
    assert auth_client.get("/api/me").status_code == 401


def test_me_requires_auth(client):
    assert client.get("/api/me").status_code == 401
