from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from sqlalchemy import text

# backend/.env (ANTHROPIC_API_KEY etc.); real env vars win. Loaded before app imports read the env.
load_dotenv(Path(__file__).parent.parent / ".env")

from app import accounts, assistant, auth, budget, calendar, meals
from app.db import Base, engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    # ponytail: hand-written column add until Alembic lands; create_all skips columns on existing tables.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE chores ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false"))
        conn.execute(text("ALTER TABLE events ADD COLUMN IF NOT EXISTS done boolean NOT NULL DEFAULT false"))
        conn.execute(text("ALTER TABLE chores ADD COLUMN IF NOT EXISTS weekdays smallint[] NOT NULL DEFAULT '{}'"))
        conn.execute(text(
            "ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS partner_id integer REFERENCES users(id) ON DELETE CASCADE"
        ))
        conn.execute(text("ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS user_share smallint NOT NULL DEFAULT 50"))
        conn.execute(text("ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS partner_share smallint NOT NULL DEFAULT 50"))
    yield


app = FastAPI(title="HomeManager", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(budget.router)
app.include_router(calendar.router)
app.include_router(meals.router)
app.include_router(assistant.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
