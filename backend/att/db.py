import os
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    create_engine,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

TOURNAMENT_ID = UUID(int=1)
INITIAL_STAGE_ID = UUID(int=2)
engine = create_engine(
    os.getenv("DATABASE_URL", "postgresql+psycopg://"),
    pool_pre_ping=True,
    connect_args={"options": "-c timezone=UTC"},
)
Session = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Tournament(Base):
    __tablename__ = "tournaments"
    __table_args__ = (CheckConstraint("id = '00000000-0000-0000-0000-000000000001'"),)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Clock(Base):
    __tablename__ = "timeline_clock"
    __table_args__ = (CheckConstraint("id = 1"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    last_seq: Mapped[int] = mapped_column(BigInteger, default=0)
    revision: Mapped[int] = mapped_column(BigInteger, default=0)


class Event:
    id: Mapped[UUID] = mapped_column(primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    row_version: Mapped[int] = mapped_column(default=1)


class Player(Event, Base):
    __tablename__ = "players"
    name: Mapped[str] = mapped_column(String(40))
    normalized_name: Mapped[str] = mapped_column(String(160), unique=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Stage(Event, Base):
    __tablename__ = "stages"
    number: Mapped[int] = mapped_column(unique=True)
    name: Mapped[str] = mapped_column(String(60))


class Drink(Event, Base):
    __tablename__ = "drinks"
    __table_args__ = (
        CheckConstraint("volume_ml > 0 AND volume_ml <= 5000"),
        CheckConstraint("abv_percent BETWEEN 0 AND 100"),
        Index("ix_drinks_player_seq", "player_id", "seq"),
    )
    player_id: Mapped[UUID] = mapped_column(ForeignKey("players.id"), index=True)
    stage_id: Mapped[UUID] = mapped_column(ForeignKey("stages.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    volume_ml: Mapped[Decimal] = mapped_column(Numeric(12, 6))
    abv_percent: Mapped[Decimal] = mapped_column(Numeric(12, 6))


class Match(Event, Base):
    __tablename__ = "matches"
    __table_args__ = (
        CheckConstraint("player_a_id != player_b_id"),
        CheckConstraint("target IN (11, 21)"),
        CheckConstraint("score_a BETWEEN 0 AND 999 AND score_b BETWEEN 0 AND 999"),
        CheckConstraint(
            "greatest(score_a, score_b) = greatest(target, least(score_a, score_b) + 2)"
        ),
        CheckConstraint("snapshot_seq >= 0 AND snapshot_seq < seq"),
        CheckConstraint("a_intoxication BETWEEN 0 AND 10"),
        CheckConstraint("b_intoxication BETWEEN 0 AND 10"),
    )
    player_a_id: Mapped[UUID] = mapped_column(ForeignKey("players.id"), index=True)
    player_b_id: Mapped[UUID] = mapped_column(ForeignKey("players.id"), index=True)
    stage_id: Mapped[UUID] = mapped_column(ForeignKey("stages.id"), index=True)
    target: Mapped[int]
    score_a: Mapped[int]
    score_b: Mapped[int]
    snapshot_seq: Mapped[int] = mapped_column(BigInteger)
    a_intoxication: Mapped[int | None]
    b_intoxication: Mapped[int | None]
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AdminSession(Base):
    __tablename__ = "admin_sessions"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Audit(Base):
    __tablename__ = "audit_log"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    session_id: Mapped[UUID]
    entity: Mapped[str] = mapped_column(String(20))
    entity_id: Mapped[UUID]
    action: Mapped[str] = mapped_column(String(20))
    before: Mapped[dict] = mapped_column(JSON)
    after: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Idempotency(Base):
    __tablename__ = "idempotency_records"
    operation: Mapped[str] = mapped_column(String(20), primary_key=True)
    key: Mapped[UUID] = mapped_column(primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    result_id: Mapped[UUID]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
