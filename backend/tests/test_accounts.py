import base64

import pytest

from app.accounts import image_mime
from app.auth import verify_password
from tests.conftest import PASSWORD

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 32
GIF = b"GIF89a" + b"\0" * 32
WEBP = b"RIFF\x24\0\0\0WEBPVP8 " + b"\0" * 32


# ---- unit ----

@pytest.mark.parametrize(
    "data,mime",
    [(PNG, "image/png"), (JPEG, "image/jpeg"), (GIF, "image/gif"), (b"GIF87a" + b"\0" * 8, "image/gif"),
     (WEBP, "image/webp"), (b"RIFF\0\0\0\0WAVE", None), (b"%PDF-1.7", None), (b"", None)],
)
def test_image_mime(data, mime):
    assert image_mime(data) == mime


# ---- /api/me ----

def test_me_returns_profile_without_password(auth_client):
    r = auth_client.get("/api/me")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"id", "email", "username", "household_size", "preferences", "avatar"}
    assert body["username"] == auth_client.user.username
    assert body["household_size"] == 1
    assert body["preferences"]["diet"] == "none"


def test_update_profile(auth_client):
    r = auth_client.put(
        "/api/me/profile",
        json={"household_size": 4, "preferences": {"diet": "vegan", "cooking_time": "quick", "dislikes": "olives"}},
    )
    assert r.status_code == 200
    assert r.json()["household_size"] == 4
    assert r.json()["preferences"]["diet"] == "vegan"
    me = auth_client.get("/api/me").json()
    assert me["preferences"]["dislikes"] == "olives"
    assert me["preferences"]["budget_level"] == "moderate"


@pytest.mark.parametrize(
    "body", [{"household_size": 0, "preferences": {}}, {"household_size": 2, "preferences": {"diet": "x"}}]
)
def test_update_profile_validation(auth_client, body):
    assert auth_client.put("/api/me/profile", json=body).status_code == 422


# ---- password ----

def test_change_password(auth_client, db):
    r = auth_client.put(
        "/api/me/password",
        json={"current_password": PASSWORD, "new_password": "Brand-new-pw1", "new_password_confirm": "Brand-new-pw1"},
    )
    assert r.status_code == 204
    db.refresh(auth_client.user)
    assert verify_password("Brand-new-pw1", auth_client.user.password_hash)


def test_change_password_wrong_current(auth_client):
    r = auth_client.put(
        "/api/me/password",
        json={"current_password": "nope-nope", "new_password": "Brand-new-pw1", "new_password_confirm": "Brand-new-pw1"},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Current password is incorrect"


@pytest.mark.parametrize("new,confirm", [("Brand-new-pw1", "Brand-new-px1"), ("short", "short"), ("no-digits-here!", "no-digits-here!")])
def test_change_password_validation(auth_client, new, confirm):
    r = auth_client.put(
        "/api/me/password", json={"current_password": PASSWORD, "new_password": new, "new_password_confirm": confirm}
    )
    assert r.status_code == 422


# ---- avatar ----

@pytest.mark.parametrize("data,mime", [(PNG, "image/png"), (JPEG, "image/jpeg"), (WEBP, "image/webp"), (GIF, "image/gif")])
def test_upload_avatar(auth_client, data, mime):
    r = auth_client.post("/api/me/avatar", files={"file": ("a.bin", data, "application/octet-stream")})
    assert r.status_code == 200
    expected = f"data:{mime};base64,{base64.b64encode(data).decode()}"
    assert r.json()["avatar"] == expected
    assert auth_client.get("/api/me").json()["avatar"] == expected


def test_upload_avatar_rejects_non_image_even_with_image_content_type(auth_client):
    r = auth_client.post("/api/me/avatar", files={"file": ("x.png", b"<svg></svg>", "image/png")})
    assert r.status_code == 400


def test_upload_avatar_too_large(auth_client):
    big = PNG + b"\0" * (1024 * 1024)
    r = auth_client.post("/api/me/avatar", files={"file": ("big.png", big, "image/png")})
    assert r.status_code == 413


def test_upload_avatar_exactly_limit_ok(auth_client):
    data = PNG + b"\0" * (1024 * 1024 - len(PNG))
    assert auth_client.post("/api/me/avatar", files={"file": ("ok.png", data, "image/png")}).status_code == 200


def test_delete_avatar(auth_client):
    auth_client.post("/api/me/avatar", files={"file": ("a.png", PNG, "image/png")})
    r = auth_client.delete("/api/me/avatar")
    assert r.status_code == 200
    assert r.json()["avatar"] is None


@pytest.mark.parametrize(
    "method,path",
    [("get", "/api/me"), ("put", "/api/me/profile"), ("put", "/api/me/password"), ("post", "/api/me/avatar"),
     ("delete", "/api/me/avatar"), ("get", "/api/links"), ("post", "/api/links"),
     ("post", "/api/links/1/accept"), ("delete", "/api/links/1")],
)
def test_account_routes_require_auth(client, method, path):
    assert getattr(client, method)(path).status_code == 401
