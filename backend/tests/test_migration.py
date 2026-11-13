import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from att.db import engine

pytestmark = pytest.mark.skipif(
    not os.getenv("ATT_TEST_DATABASE_URL"), reason="Requires PostgreSQL"
)


def test_upgrade_preserves_existing_evening(monkeypatch):
    from fastapi.testclient import TestClient

    from att import db, main

    assert engine.url.database and engine.url.database.endswith("_test")
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    with engine.connect() as connection:
        connection.execute(text("CREATE SCHEMA migration_rehearsal"))
        connection.commit()
        try:
            connection.execute(text("SET search_path TO migration_rehearsal"))
            connection.commit()
            from sqlalchemy import create_engine

            isolated = create_engine(
                engine.url, connect_args={"options": "-c search_path=migration_rehearsal"}
            )
            monkeypatch.setattr(db, "engine", isolated)
            command.upgrade(config, "0001")
            with isolated.begin() as tx:
                tx.execute(
                    text("""
                    INSERT INTO players (id, name, normalized_name, seq, row_version) VALUES
                    ('00000000-0000-0000-0000-000000000010', 'A', 'a', 1, 1),
                    ('00000000-0000-0000-0000-000000000011', 'B', 'b', 2, 1);
                    INSERT INTO stages (id, seq, number, name, row_version)
                    VALUES ('00000000-0000-0000-0000-000000000012', 3, 1, 'Old', 1);
                    INSERT INTO drinks (id, player_id, stage_id, name, volume_ml, abv_percent, seq, row_version)
                    VALUES ('00000000-0000-0000-0000-000000000013',
                        '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000012',
                        'Beer', 500.125, 5, 4, 2);
                    INSERT INTO matches (id, player_a_id, player_b_id, stage_id, target, score_a, score_b,
                        snapshot_seq, seq, row_version, a_intoxication, b_intoxication)
                    VALUES ('00000000-0000-0000-0000-000000000014',
                        '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011',
                        '00000000-0000-0000-0000-000000000012', 11, 12, 10, 4, 5, 3, NULL, 0);
                    INSERT INTO admin_sessions (id, token_hash, expires_at)
                    VALUES ('00000000-0000-0000-0000-000000000015', 'hash', now() + interval '1 day');
                    INSERT INTO idempotency_records (operation, key, fingerprint, result_id)
                    VALUES ('matches', '00000000-0000-0000-0000-000000000016', 'old-fingerprint',
                        '00000000-0000-0000-0000-000000000014');
                    INSERT INTO audit_log (id, session_id, entity, entity_id, action, before, after)
                    VALUES ('00000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000000015',
                        'stages', '00000000-0000-0000-0000-000000000012', 'edit', '{"stage_id":"history"}', '{}');
                    UPDATE timeline_clock SET last_seq = 5, revision = 3;
                """)
                )
            tables = (
                "players",
                "drinks",
                "matches",
                "admin_sessions",
                "idempotency_records",
                "audit_log",
                "timeline_clock",
                "tournaments",
            )

            def rows():
                with isolated.connect() as tx:
                    return {
                        table: tx.execute(
                            text(f"SELECT to_jsonb(t) - 'stage_id' FROM {table} t ORDER BY 1")
                        )
                        .scalars()
                        .all()
                        for table in tables
                    }

            before = rows()
            command.upgrade(config, "head")
            command.upgrade(config, "head")
            assert rows() == before
            with isolated.connect() as tx:
                assert tx.scalar(text("SELECT to_regclass('stages')")) is None
                assert tx.scalar(text("SELECT version_num FROM alembic_version")) == "0002"

            from sqlalchemy.orm import sessionmaker

            monkeypatch.setattr(main, "Session", sessionmaker(isolated))
            with TestClient(main.app) as client:
                response = client.get(
                    "/api/v1/match-publication",
                    headers={"Idempotency-Key": "00000000-0000-0000-0000-000000000016"},
                )
                assert response.json() == {"match_id": "00000000-0000-0000-0000-000000000014"}
                view = client.get("/api/v1/state").json()
                assert view["snapshot_seq"] == 5
                assert view["matches"][0]["a"]["self_rating"] is None
                assert view["matches"][0]["b"]["self_rating"] == 0
            isolated.dispose()
        finally:
            connection.execute(text("DROP SCHEMA migration_rehearsal CASCADE"))
            connection.commit()
