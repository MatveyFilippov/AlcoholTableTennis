import hashlib
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .db import Audit, Clock, Drink, Idempotency, Match, Player, Stage
from .schemas import DrinkInput, Input, MatchInput, PlayerInput, StageInput

ENTITIES = {"players": Player, "stages": Stage, "drinks": Drink, "matches": Match}


class Problem(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def clock(db: Session, *, write: bool = False) -> Clock:
    value = db.scalar(select(Clock).where(Clock.id == 1).with_for_update(read=not write))
    if value is None:
        raise Problem(503, "STORAGE_UNAVAILABLE", "Хранилище готовится к работе")
    return value


def record(row: Any) -> dict[str, Any]:
    return jsonable_encoder(
        {
            column.key: getattr(row, column.key)
            for column in row.__table__.columns
            if column.key != "normalized_name"
        }
    )


def find(db: Session, model: Any, id: UUID, *, deleted: bool = False) -> Any:
    row = db.get(model, id)
    if row is None or (row.deleted_at and not deleted):
        raise Problem(404, "NOT_FOUND", "Запись не найдена")
    return row


def current_stage(db: Session, seq: int) -> Stage:
    stage = db.scalar(
        select(Stage)
        .where(Stage.seq <= seq, Stage.deleted_at.is_(None))
        .order_by(Stage.seq.desc())
        .limit(1)
    )
    assert stage is not None
    return stage


def payload_values(
    db: Session, payload: Input, timeline: Clock, existing: Any = None
) -> dict[str, Any]:
    data = payload.model_dump(exclude={"mode", "row_version", "archived"})
    if isinstance(payload, PlayerInput):
        normalized = payload.name.casefold()
        duplicate = db.scalar(select(Player).where(Player.normalized_name == normalized))
        if duplicate is not None and (existing is None or duplicate.id != existing.id):
            raise Problem(409, "DUPLICATE_NAME", "Такое имя уже есть. Выберите другое.")
        data["normalized_name"] = normalized
    if isinstance(payload, StageInput) and existing is None:
        number = (db.scalar(select(func.max(Stage.number))) or 0) + 1
        data.update(number=number, name=payload.name or f"Раунд {number}")
    if isinstance(payload, DrinkInput):
        player = find(db, Player, payload.player_id)
        stage = find(db, Stage, payload.stage_id)
        if existing is None and player.archived_at:
            raise Problem(409, "ARCHIVED_PLAYER", "Игрок скрыт из новых записей")
        if existing is not None and max(player.seq, stage.seq) >= existing.seq:
            raise Problem(409, "INVALID_TIMELINE", "Игрок и этап должны существовать до записи")
        if stage.number == 0 and payload.abv_percent > 0:
            raise Problem(422, "SOBER_STAGE", "Для напитка с алкоголем добавьте следующий этап")
    if isinstance(payload, MatchInput):
        a = find(db, Player, payload.player_a_id)
        b = find(db, Player, payload.player_b_id)
        stage = find(db, Stage, payload.stage_id)
        snap = payload.snapshot_seq
        if existing is not None and snap != existing.snapshot_seq:
            raise Problem(409, "INVALID_SNAPSHOT", "Снимок начала матча нельзя изменить")
        if max(a.seq, b.seq, stage.seq) > snap or snap > timeline.last_seq:
            raise Problem(
                409, "INVALID_SNAPSHOT", "Игроки и этап должны существовать на момент начала"
            )
        if existing is None:
            if a.archived_at or b.archived_at:
                raise Problem(409, "ARCHIVED_PLAYER", "Выберите активных игроков")
            if payload.mode == "quick" and snap != timeline.last_seq:
                raise Problem(409, "STALE_STATE", "Вечер обновился. Обновите данные перед записью.")
            if stage.id != current_stage(db, snap).id:
                raise Problem(
                    409, "INVALID_STAGE", "Выбранный этап не был текущим на момент начала"
                )
        if stage.number == 0:
            if payload.a_intoxication not in (0, None) or payload.b_intoxication not in (0, None):
                raise Problem(
                    422, "SOBER_STAGE", "Для этапа «Трезвые» используется начальная оценка 0"
                )
            data.update(a_intoxication=0, b_intoxication=0)
    return data


def create(db: Session, entity: str, payload: Input, key: UUID) -> dict[str, Any]:
    timeline = clock(db, write=True)
    fingerprint = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    previous = db.get(Idempotency, (entity, key))
    model = ENTITIES[entity]
    if previous is not None:
        if previous.fingerprint != fingerprint:
            raise Problem(
                409, "IDEMPOTENCY_CONFLICT", "Этот ключ уже использован для другой записи"
            )
        return record(find(db, model, previous.result_id, deleted=True))
    values = payload_values(db, payload, timeline)
    timeline.last_seq += 1
    row = model(id=uuid4(), seq=timeline.last_seq, **values)
    db.add(row)
    db.add(Idempotency(operation=entity, key=key, fingerprint=fingerprint, result_id=row.id))
    db.flush()
    return record(row)


def change(
    db: Session,
    entity: str,
    id: UUID,
    action: str,
    version: int,
    session_id: UUID,
    payload: Input | None = None,
) -> dict[str, Any]:
    timeline = clock(db, write=True)
    row = find(db, ENTITIES[entity], id, deleted=True)
    if row.row_version != version:
        raise Problem(409, "STALE_VERSION", "Запись уже изменилась. Обновите страницу.")
    if isinstance(row, Stage) and row.number == 0:
        raise Problem(403, "SYSTEM_STAGE", "Системный этап нельзя изменить")
    if bool(row.deleted_at) != (action == "restore"):
        raise Problem(409, "INVALID_ACTION", "Действие не подходит для текущего состояния записи")
    before = record(row)
    if action == "edit":
        assert payload is not None
        for key, value in payload_values(db, payload, timeline, row).items():
            setattr(row, key, value)
        if isinstance(row, Player):
            row.archived_at = (row.archived_at or datetime.now(UTC)) if payload.archived else None
    elif action == "delete":
        if isinstance(row, (Player, Stage)):
            if isinstance(row, Player):
                matches = or_(Match.player_a_id == id, Match.player_b_id == id)
                drinks = Drink.player_id == id
            else:
                matches = Match.stage_id == id
                drinks = Drink.stage_id == id
            if db.scalar(select(Match.id).where(matches, Match.deleted_at.is_(None)).limit(1)) or (
                db.scalar(select(Drink.id).where(drinks, Drink.deleted_at.is_(None)).limit(1))
            ):
                raise Problem(409, "DEPENDENCIES", "Сначала обработайте связанные матчи и напитки")
        row.deleted_at = datetime.now(UTC)
    else:
        if isinstance(row, (Drink, Match)):
            find(db, Stage, row.stage_id)
        if isinstance(row, Drink):
            find(db, Player, row.player_id)
        if isinstance(row, Match):
            find(db, Player, row.player_a_id)
            find(db, Player, row.player_b_id)
        row.deleted_at = None
    row.row_version += 1
    timeline.revision += 1
    after = record(row)
    db.add(
        Audit(
            id=uuid4(),
            session_id=session_id,
            entity=entity,
            entity_id=id,
            action=action,
            before=before,
            after=after,
        )
    )
    return after
