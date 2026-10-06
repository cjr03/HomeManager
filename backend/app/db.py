import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

engine = create_engine(os.environ.get("DATABASE_URL", "postgresql+psycopg:///homemanager"))
SessionLocal = sessionmaker(engine)


class Base(DeclarativeBase):
    pass


def get_db():
    with SessionLocal() as db:
        yield db
