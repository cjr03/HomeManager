from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from app import accounts, auth, budget, calendar, meals
from app.db import Base, engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    # ponytail: hand-written column add until Alembic lands; create_all skips columns on existing tables.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE chores ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false"))
        conn.execute(text("ALTER TABLE chores ADD COLUMN IF NOT EXISTS weekdays smallint[] NOT NULL DEFAULT '{}'"))
    yield


app = FastAPI(title="HomeManager", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(budget.router)
app.include_router(calendar.router)
app.include_router(meals.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
