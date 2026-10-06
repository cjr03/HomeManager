import base64
from typing import Literal

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel, model_validator
from sqlalchemy import ForeignKey, Index, String, func, or_, select
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from app.auth import DB, CurrentUser, Password, ProfileIn, User, UserOut, find_user, hash_password, verify_password
from app.db import Base

MAX_AVATAR_BYTES = 1024 * 1024


class Link(Base):
    __tablename__ = "links"

    id: Mapped[int] = mapped_column(primary_key=True)
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    addressee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[Literal["pending", "accepted"]] = mapped_column(String(8), default="pending")
    requester: Mapped[User] = relationship(foreign_keys=[requester_id])
    addressee: Mapped[User] = relationship(foreign_keys=[addressee_id])


# One link per unordered pair of users.
Index(
    "uq_links_pair",
    func.least(Link.requester_id, Link.addressee_id),
    func.greatest(Link.requester_id, Link.addressee_id),
    unique=True,
)


def linked_user_ids(db: Session, user: User) -> set[int]:
    """Ids of users with an accepted link to `user`, in either direction."""
    rows = db.execute(
        select(Link.requester_id, Link.addressee_id).where(
            Link.status == "accepted", or_(Link.requester_id == user.id, Link.addressee_id == user.id)
        )
    )
    return {a if b == user.id else b for a, b in rows}


def image_mime(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: Password
    new_password_confirm: str

    @model_validator(mode="after")
    def _match(self):
        if self.new_password != self.new_password_confirm:
            raise ValueError("Passwords do not match")
        return self


class LinkIn(BaseModel):
    username: str


class LinkOut(BaseModel):
    id: int
    user_id: int
    username: str
    avatar: str | None


class LinksOut(BaseModel):
    incoming: list[LinkOut]
    outgoing: list[LinkOut]
    linked: list[LinkOut]


def _link_out(link: Link, me: User) -> LinkOut:
    other = link.addressee if link.requester_id == me.id else link.requester
    return LinkOut(id=link.id, user_id=other.id, username=other.username, avatar=other.avatar)


router = APIRouter(prefix="/api", tags=["accounts"])


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.put("/me/profile", response_model=UserOut)
def update_profile(body: ProfileIn, user: CurrentUser, db: DB):
    user.household_size = body.household_size
    user.preferences = body.preferences.model_dump(mode="json")
    db.commit()
    return user


@router.put("/me/password", status_code=204)
def change_password(body: PasswordChangeIn, user: CurrentUser, db: DB):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.commit()


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(file: UploadFile, user: CurrentUser, db: DB):
    data = await file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "Image must be 1 MB or smaller")
    mime = image_mime(data)
    if mime is None:
        raise HTTPException(400, "Upload a PNG, JPEG, WebP or GIF image")
    user.avatar = f"data:{mime};base64,{base64.b64encode(data).decode()}"
    db.commit()
    return user


@router.delete("/me/avatar", response_model=UserOut)
def delete_avatar(user: CurrentUser, db: DB):
    user.avatar = None
    db.commit()
    return user


@router.get("/links", response_model=LinksOut)
def list_links(user: CurrentUser, db: DB):
    links = db.scalars(
        select(Link).where(or_(Link.requester_id == user.id, Link.addressee_id == user.id)).order_by(Link.id)
    )
    out = LinksOut(incoming=[], outgoing=[], linked=[])
    for link in links:
        bucket = (
            out.linked if link.status == "accepted" else out.outgoing if link.requester_id == user.id else out.incoming
        )
        bucket.append(_link_out(link, user))
    return out


@router.post("/links", status_code=201, response_model=LinkOut)
def request_link(body: LinkIn, user: CurrentUser, db: DB):
    other = find_user(db, body.username)
    if other is None:
        raise HTTPException(404, "No user with that username")
    if other.id == user.id:
        raise HTTPException(400, "You can't link with yourself")
    pair = {user.id, other.id}
    if db.scalar(select(Link).where(Link.requester_id.in_(pair), Link.addressee_id.in_(pair))):
        raise HTTPException(409, "A link with that user already exists")
    link = Link(requester=user, addressee=other)
    db.add(link)
    db.commit()
    return _link_out(link, user)


def _get_link(db: Session, link_id: int, user: User) -> Link:
    link = db.get(Link, link_id)
    if link is None or user.id not in (link.requester_id, link.addressee_id):
        raise HTTPException(404, "Link not found")
    return link


@router.post("/links/{link_id}/accept", response_model=LinkOut)
def accept_link(link_id: int, user: CurrentUser, db: DB):
    link = _get_link(db, link_id, user)
    if link.addressee_id != user.id:
        raise HTTPException(404, "Link not found")
    link.status = "accepted"
    db.commit()
    return _link_out(link, user)


@router.delete("/links/{link_id}", status_code=204)
def delete_link(link_id: int, user: CurrentUser, db: DB):
    db.delete(_get_link(db, link_id, user))
    db.commit()
