import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest

URL = os.getenv("ATT_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Set ATT_TEST_DATABASE_URL to an isolated PostgreSQL database"
)
CSRF = {"X-ATT-Admin": "1"}


@pytest.fixture
def client(monkeypatch):
    from alembic import command
    from alembic.config import Config
    from argon2 import PasswordHasher
    from fastapi.testclient import TestClient
    from sqlalchemy import text

    assert URL and URL.endswith("_test"), "Use a disposable database ending in _test"
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("ADMIN_PASSWORD_HASH", PasswordHasher().hash("local-test-pass"))
    from att.db import engine
    from att.main import app, attempts

    assert engine.url.database and engine.url.database.endswith("_test")
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    with engine.begin() as db:
        db.execute(
            text(
                "TRUNCATE audit_log, admin_sessions, idempotency_records, matches, drinks, players"
            )
        )
        db.execute(text("DELETE FROM stages WHERE number > 0"))
        db.execute(text("UPDATE timeline_clock SET last_seq=0, revision=0"))
    attempts.clear()
    with TestClient(app, base_url="https://testserver") as test:
        yield test


def post(client, entity, data, key=None, status=201):
    response = client.post(
        "/api/v1/" + entity, json=data, headers={"Idempotency-Key": key or str(uuid4())}
    )
    assert response.status_code == status, response.text
    return response.json()


def state(client):
    response = client.get("/api/v1/state")
    assert response.status_code == 200, response.text
    return response.json()


def sign_in(client):
    response = client.post(
        "/api/v1/admin/login", json={"password": "local-test-pass"}, headers=CSRF
    )
    assert response.status_code == 200, response.text
    assert all(
        part in response.headers["set-cookie"].lower()
        for part in ("httponly", "secure", "samesite=strict")
    )


def match_data(a, b, snapshot, **extra):
    return {
        "player_a_id": a["id"],
        "player_b_id": b["id"],
        "stage_id": snapshot["current_stage"]["id"],
        "target": 11,
        "score_a": 11,
        "score_b": 9,
        "snapshot_seq": snapshot["snapshot_seq"],
        "a_intoxication": 0,
        "b_intoxication": 0,
        **extra,
    }


def test_empty_and_validation(client):
    empty = state(client)
    assert client.get("/api/health/ready").status_code == 200
    assert empty["players"] == empty["matches"] == empty["drinks"] == []
    assert len(empty["stages"]) == 1
    assert empty["current_stage"]["name"] == "Трезвые"
    a = post(client, "players", {"name": "  Аня  "})
    post(client, "players", {"name": "АНЯ"}, status=409)
    b = post(client, "players", {"name": "Борис"})
    valid = match_data(a, b, state(client))
    for invalid in [
        {"score_a": "11"},
        {"score_a": 11.0},
        {"score_a": 12},
        {"score_b": 10},
        {"a_intoxication": 11},
        {"a_intoxication": -1},
        {"a_intoxication": 0.5},
        {"player_b_id": a["id"]},
    ]:
        post(client, "matches", valid | invalid, status=422)
    key = str(uuid4())
    m = post(client, "matches", valid, key)
    assert post(client, "matches", valid, key)["id"] == m["id"]
    post(client, "matches", valid | {"score_b": 8}, key, 409)
    view = state(client)
    assert [p["elo"] for p in view["players"]] == [1016, 984]
    assert [p["sober_elo"] for p in view["players"]] == [1016, 984]
    assert len(view["matches"]) == 1


def test_snapshots_and_historical_replay(client):
    a, b, c = [post(client, "players", {"name": name}) for name in ["Анна", "Борис", "Вера"]]
    stage = post(client, "stages", {})
    prior = state(client)
    drink_data = {
        "name": "Пиво",
        "player_id": a["id"],
        "stage_id": stage["id"],
        "volume_ml": 500,
        "abv_percent": 5,
    }
    post(client, "drinks", drink_data | {"abv_percent": -1}, status=422)
    drink = post(client, "drinks", drink_data)
    post(client, "matches", match_data(a, b, prior), status=409)
    early = post(client, "matches", match_data(a, b, prior, mode="live"))
    later = post(
        client, "matches", match_data(a, c, state(client), score_a=19, score_b=21, target=21)
    )
    post(client, "matches", match_data(b, c, state(client), a_intoxication=None, b_intoxication=10))
    before = state(client)
    unknown, late, live = before["matches"]
    assert live["a"]["ethanol_g"] == 0 and live["sober"]
    assert late["a"]["ethanol_g"] == pytest.approx(19.725) and not late["sober"]
    assert unknown["a"]["self_rating"] is None and not unknown["sober"]
    assert client.patch(
        "/api/v1/admin/matches/" + early["id"], json={}, headers=CSRF
    ).status_code in (401, 422)
    sign_in(client)
    assert client.post("/api/v1/admin/logout").status_code == 403
    drink_path = "/api/v1/admin/drinks/" + drink["id"]
    response = client.patch(
        drink_path, json=drink_data | {"abv_percent": 0, "row_version": 1}, headers=CSRF
    )
    assert response.status_code == 200, response.text
    assert client.get("/api/v1/matches/" + later["id"]).json()["sober"]
    assert (
        client.patch(drink_path, json=drink_data | {"row_version": 1}, headers=CSRF).status_code
        == 409
    )
    match_path = "/api/v1/admin/matches/" + early["id"]
    patch = match_data(a, b, prior, score_a=9, score_b=11, row_version=1)
    preview = client.post(match_path + "/preview", json=patch, headers=CSRF)
    assert preview.status_code == 200, preview.text
    assert {p["name"] for p in preview.json()} == {"Анна", "Борис", "Вера"}
    assert state(client)["matches"][1]["a"]["elo_before"] == 1016
    response = client.patch(match_path, json=patch, headers=CSRF)
    assert response.status_code == 200, response.text
    corrected = state(client)
    assert corrected["matches"][1]["a"]["elo_before"] == 984
    assert corrected["projection_version"] != before["projection_version"]
    for entity, row in [("players", a), ("stages", stage)]:
        response = client.request(
            "DELETE", f"/api/v1/admin/{entity}/{row['id']}", json={"row_version": 1}, headers=CSRF
        )
        assert response.status_code == 409
    response = client.request("DELETE", match_path, json={"row_version": 2}, headers=CSRF)
    assert response.status_code == 200
    assert state(client)["matches"][1]["a"]["elo_before"] == 1000
    response = client.post(match_path + "/restore", json={"row_version": 3}, headers=CSRF)
    assert response.status_code == 200
    assert state(client)["matches"][1]["a"] == corrected["matches"][1]["a"]
    assert len(client.get("/api/v1/admin/audit").json()) == 4
    assert client.post("/api/v1/admin/logout", headers=CSRF).status_code == 200
    assert client.get("/api/v1/admin/records").status_code == 401


def test_canonical_sequence_and_idempotency_under_concurrency(client):
    a = post(client, "players", {"name": "А"})
    b = post(client, "players", {"name": "Б"})
    s = post(client, "stages", {})
    prior = state(client)
    live = match_data(a, b, prior, mode="live")
    drink = {
        "player_id": a["id"],
        "stage_id": s["id"],
        "name": "Сидр",
        "volume_ml": 100,
        "abv_percent": 5,
    }
    key = str(uuid4())
    with ThreadPoolExecutor(max_workers=3) as pool:
        first = pool.submit(post, client, "matches", live, key)
        second = pool.submit(post, client, "matches", live, key)
        third = pool.submit(post, client, "drinks", drink)
        assert first.result()["id"] == second.result()["id"]
        assert {first.result()["seq"], third.result()["seq"]} == {4, 5}
    view = state(client)
    assert view["snapshot_seq"] == 5 and len(view["matches"]) == 1
    assert view["matches"][0]["a"]["ethanol_g"] == 0


def test_admin_login_throttle(client):
    for _ in range(5):
        assert (
            client.post("/api/v1/admin/login", json={"password": "wrong"}, headers=CSRF).status_code
            == 401
        )
    assert (
        client.post("/api/v1/admin/login", json={"password": "wrong"}, headers=CSRF).status_code
        == 429
    )
