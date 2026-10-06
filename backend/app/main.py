from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import Base, engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="HomeManager", lifespan=lifespan)


@app.get("/api/health")
def health():
    return {"status": "ok"}
