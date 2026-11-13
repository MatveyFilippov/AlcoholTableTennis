import hashlib
import logging
import os
import secrets
import time
from collections import OrderedDict, deque
from datetime import UTC, datetime, timedelta
from threading import Lock
from typing import Annotated
from uuid import UUID, uuid4

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, FastAPI, Header, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session as DB
from starlette.exceptions import HTTPException

from .db import AdminSession, Audit, Idempotency, Session
from .projection import profile, project
from .schemas import (
    DrinkEdit,
    DrinkInput,
    Login,
    MatchEdit,
    MatchInput,
    PlayerEdit,
    PlayerInput,
    Revision,
)
from .service import ENTITIES, Problem, change, clock, create, record

log = logging.getLogger("uvicorn.error")
app = FastAPI(
    title="Alcohol Table Tennis",
    version="1.0",
    docs_url="/api/docs" if os.getenv("ATT_DOCS") == "1" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if os.getenv("ATT_DOCS") == "1" else None,
)
api = APIRouter(prefix="/api/v1")
COOKIE = "att_admin"
VERSION = os.getenv("ATT_VERSION", "local")
SECURE = os.getenv("ATT_INSECURE_LOCAL") != "1"


def transaction():
    with Session.begin() as db:
        yield db


Database = Annotated[DB, Depends(transaction, scope="function")]
Key = Annotated[UUID, Header(alias="Idempotency-Key")]


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.id = uuid4().hex
    start = time.monotonic()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.id
    response.headers["Cache-Control"] = "no-store"
    log.info(
        "request=%s method=%s path=%s status=%d ms=%.1f",
        request.state.id,
        request.method,
        request.url.path,
        response.status_code,
        1000 * (time.monotonic() - start),
    )
    return response


@app.exception_handler(Problem)
async def problem(request: Request, exc: Problem):
    return JSONResponse(
        status_code=exc.status,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "request_id": request.state.id,
            }
        },
    )


@app.exception_handler(RequestValidationError)
async def invalid(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    issue = errors[0]
    field = str(issue["loc"][-1])
    detail = issue.get("ctx", {}).get("error")
    message = str(detail) if isinstance(detail, ValueError) else f"Проверьте поле «{field}»"
    return await problem(request, Problem(422, "INVALID_INPUT", message))


@app.exception_handler(SQLAlchemyError)
async def unavailable(request: Request, exc: SQLAlchemyError):
    log.warning("request=%s storage_error=%s", request.state.id, type(exc).__name__)
    return await problem(
        request, Problem(503, "STORAGE_UNAVAILABLE", "Хранилище временно недоступно")
    )


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return await problem(request, Problem(exc.status_code, "HTTP_ERROR", "Действие недоступно"))


attempts: OrderedDict[tuple[str, str], deque[float]] = OrderedDict()
attempts_lock = Lock()


def limit(request: Request, group: str, maximum: int, window: int):
    peer = request.client.host if request.client else "local"
    client = (
        request.headers.get("X-ATT-Client-IP", peer) if os.getenv("ATT_TRUST_EDGE") == "1" else peer
    )
    key = (group, client)
    now = time.monotonic()
    with attempts_lock:
        history = attempts.setdefault(key, deque())
        attempts.move_to_end(key)
        if len(attempts) > 4096:
            attempts.popitem(last=False)
        while history and history[0] <= now - window:
            history.popleft()
        if len(history) >= maximum:
            raise Problem(429, "RATE_LIMIT", "Слишком много запросов. Попробуйте позже.")
        history.append(now)


def write_limit(request: Request):
    limit(request, "write", 120, 60)


def csrf(request: Request):
    # A custom header requires a same-origin request or CORS preflight. CORS is disabled.
    if request.headers.get("X-ATT-Admin") != "1":
        raise Problem(403, "CSRF", "Действие доступно только из приложения")


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def admin(request: Request, db: Database) -> AdminSession:
    token = request.cookies.get(COOKIE, "")
    if len(token) == 43:
        session = db.scalar(
            select(AdminSession).where(
                AdminSession.token_hash == token_hash(token),
                AdminSession.expires_at > datetime.now(UTC),
            )
        )
        if session:
            return session
    raise Problem(401, "UNAUTHORIZED", "Войдите как администратор")


Admin = Annotated[AdminSession, Depends(admin)]


@app.get("/api/health/live")
def live():
    return {"status": "ok", "version": VERSION}


@app.get("/api/health/ready")
def ready(db: Database):
    clock(db)
    tables = db.execute(
        text(
            "SELECT to_regclass('matches'), to_regclass('drinks'), to_regclass('admin_sessions'), to_regclass('stages') IS NULL"
        )
    ).one()
    if not all(tables):
        raise Problem(503, "SCHEMA_UNAVAILABLE", "Схема хранилища ещё не готова")
    db.execute(text("SELECT 1 FROM tournaments LIMIT 1"))
    return live()


@api.get("/state")
def state(db: Database):
    return project(db)


@api.get("/players")
@api.get("/leaderboard")
def players(db: Database):
    return project(db)["players"]


@api.get("/drinks")
def drinks(db: Database, player_id: UUID | None = None):
    return [
        d for d in project(db)["drinks"] if (player_id is None or d["player_id"] == str(player_id))
    ]


@api.get("/matches")
def matches(
    db: Database,
    player_id: UUID | None = None,
    opponent_id: UUID | None = None,
    target: int | None = None,
    oldest: bool = False,
):
    rows = [
        m
        for m in project(db)["matches"]
        if (player_id is None or str(player_id) in (m["player_a_id"], m["player_b_id"]))
        and (opponent_id is None or str(opponent_id) in (m["player_a_id"], m["player_b_id"]))
        and (target is None or m["target"] == target)
    ]
    return rows[::-1] if oldest else rows


def lookup(rows: list[dict], id: UUID) -> dict:
    for row in rows:
        if row["id"] == str(id):
            return row
    raise Problem(404, "NOT_FOUND", "Запись не найдена")


@api.get("/players/{id}")
@api.get("/analytics/players/{id}")
def player(id: UUID, db: Database):
    view = project(db)
    return profile(view, lookup(view["players"], id))


@api.get("/match-publication")
def match_publication(key: Key, db: Database):
    """Resolve an uncertain publication without replaying a legacy payload."""
    clock(db)
    result = db.get(Idempotency, ("matches", key))
    return {"match_id": result.result_id if result is not None else None}


@api.get("/matches/{id}")
def match(id: UUID, db: Database):
    return lookup(project(db)["matches"], id)


@api.get("/analytics/overview")
def overview(db: Database):
    return project(db)


@api.get("/analytics/head-to-head")
def head_to_head(db: Database, player_a: UUID, player_b: UUID):
    if player_a == player_b:
        raise Problem(422, "SAME_PLAYER", "Выберите двух разных игроков")
    view = project(db)
    for id in (player_a, player_b):
        lookup(view["players"], id)
    rows = [
        m
        for m in view["matches"]
        if {m["player_a_id"], m["player_b_id"]} == {str(player_a), str(player_b)}
    ]
    return {
        "n": len(rows),
        "a_wins": sum(m["winner_id"] == str(player_a) for m in rows),
        "b_wins": sum(m["winner_id"] == str(player_b) for m in rows),
        "matches": rows,
    }


@api.post("/players", status_code=201, dependencies=[Depends(write_limit)])
def add_player(payload: PlayerInput, key: Key, db: Database):
    return create(db, "players", payload, key)


@api.post("/drinks", status_code=201, dependencies=[Depends(write_limit)])
def add_drink(payload: DrinkInput, key: Key, db: Database):
    return create(db, "drinks", payload, key)


@api.post("/matches", status_code=201, dependencies=[Depends(write_limit)])
def add_match(payload: MatchInput, key: Key, db: Database):
    return create(db, "matches", payload, key)


@api.post("/admin/login", dependencies=[Depends(csrf)])
def login(payload: Login, request: Request, response: Response, db: Database):
    limit(request, "login", 5, 300)
    password = os.getenv("ADMIN_PASSWORD_HASH", "")
    if not password.startswith("$argon2id$"):
        raise Problem(503, "ADMIN_DISABLED", "Вход администратора ещё не настроен")
    try:
        PasswordHasher().verify(password, payload.password)
    except (VerificationError, InvalidHashError):
        raise Problem(401, "INVALID_PASSWORD", "Неверный пароль") from None
    db.execute(delete(AdminSession).where(AdminSession.expires_at <= datetime.now(UTC)))
    token = secrets.token_urlsafe(32)
    db.add(
        AdminSession(
            id=uuid4(),
            token_hash=token_hash(token),
            expires_at=datetime.now(UTC) + timedelta(hours=8),
        )
    )
    response.set_cookie(
        COOKIE,
        token,
        max_age=28800,
        httponly=True,
        secure=SECURE,
        samesite="strict",
        path="/api/v1/admin",
    )
    return {"authenticated": True}


@api.get("/admin/me")
def me(session: Admin):
    return {"authenticated": True}


@api.post("/admin/logout", dependencies=[Depends(csrf)])
def logout(session: Admin, db: Database, response: Response):
    db.delete(session)
    response.delete_cookie(
        COOKIE, path="/api/v1/admin", httponly=True, secure=SECURE, samesite="strict"
    )
    return {"authenticated": False}


@api.get("/admin/audit")
def audit(session: Admin, db: Database):
    return [
        record(row)
        for row in db.scalars(select(Audit).order_by(Audit.created_at.desc()).limit(200))
    ]


@api.get("/admin/records")
def records(session: Admin, db: Database):
    clock(db)
    return {
        entity: [record(row) for row in db.scalars(select(model).order_by(model.seq.desc()))]
        for entity, model in ENTITIES.items()
    }


@api.patch("/admin/players/{id}", dependencies=[Depends(csrf)])
def edit_player(id: UUID, payload: PlayerEdit, session: Admin, db: Database):
    return change(db, "players", id, "edit", payload.row_version, session.id, payload)


@api.patch("/admin/drinks/{id}", dependencies=[Depends(csrf)])
def edit_drink(id: UUID, payload: DrinkEdit, session: Admin, db: Database):
    return change(db, "drinks", id, "edit", payload.row_version, session.id, payload)


@api.post("/admin/matches/{id}/preview", dependencies=[Depends(csrf)])
def preview_match(id: UUID, payload: MatchEdit, session: Admin, db: Database):
    clock(db, write=True)
    before = project(db)
    with db.begin_nested() as preview:
        change(db, "matches", id, "edit", payload.row_version, session.id, payload)
        after = project(db)
        preview.rollback()
    previous = {p["id"]: p for p in before["players"]}
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "before": previous[p["id"]]["elo"],
            "after": p["elo"],
        }
        for p in after["players"]
        if p["elo"] != previous[p["id"]]["elo"]
    ]


@api.patch("/admin/matches/{id}", dependencies=[Depends(csrf)])
def edit_match(id: UUID, payload: MatchEdit, session: Admin, db: Database):
    return change(db, "matches", id, "edit", payload.row_version, session.id, payload)


def entity_name(entity: str) -> str:
    if entity not in ENTITIES:
        raise Problem(404, "NOT_FOUND", "Раздел не найден")
    return entity


@api.delete("/admin/{entity}/{id}", dependencies=[Depends(csrf)])
def remove(entity: str, id: UUID, payload: Revision, session: Admin, db: Database):
    return change(db, entity_name(entity), id, "delete", payload.row_version, session.id)


@api.post("/admin/{entity}/{id}/restore", dependencies=[Depends(csrf)])
def restore(entity: str, id: UUID, payload: Revision, session: Admin, db: Database):
    return change(db, entity_name(entity), id, "restore", payload.row_version, session.id)


app.include_router(api)
