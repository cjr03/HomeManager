from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import accounts, auth, budget, calendar
from app.db import Base, engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="HomeManager", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(budget.router)
app.include_router(calendar.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
