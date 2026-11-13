"""Initialize the ATT schema and the single evening."""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
CREATE TABLE tournaments (
	id UUID NOT NULL,
	title VARCHAR(80) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	PRIMARY KEY (id),
	CHECK (id = '00000000-0000-0000-0000-000000000001')
)
    """)
    op.execute("""
CREATE TABLE timeline_clock (
	id SERIAL NOT NULL,
	last_seq BIGINT NOT NULL,
	revision BIGINT NOT NULL,
	PRIMARY KEY (id),
	CHECK (id = 1)
)
    """)
    op.execute("""
CREATE TABLE players (
	name VARCHAR(40) NOT NULL,
	normalized_name VARCHAR(160) NOT NULL,
	archived_at TIMESTAMP WITH TIME ZONE,
	id UUID NOT NULL,
	seq BIGINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	deleted_at TIMESTAMP WITH TIME ZONE,
	row_version INTEGER NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (normalized_name),
	UNIQUE (seq)
)
    """)
    op.execute("""
CREATE TABLE stages (
	number INTEGER NOT NULL,
	name VARCHAR(60) NOT NULL,
	id UUID NOT NULL,
	seq BIGINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	deleted_at TIMESTAMP WITH TIME ZONE,
	row_version INTEGER NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (number),
	UNIQUE (seq)
)
    """)
    op.execute("""
CREATE TABLE admin_sessions (
	id UUID NOT NULL,
	token_hash VARCHAR(64) NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (token_hash)
)
    """)
    op.execute("""
CREATE TABLE audit_log (
	id UUID NOT NULL,
	session_id UUID NOT NULL,
	entity VARCHAR(20) NOT NULL,
	entity_id UUID NOT NULL,
	action VARCHAR(20) NOT NULL,
	before JSON NOT NULL,
	after JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	PRIMARY KEY (id)
)
    """)
    op.execute("""
CREATE TABLE idempotency_records (
	operation VARCHAR(20) NOT NULL,
	key UUID NOT NULL,
	fingerprint VARCHAR(64) NOT NULL,
	result_id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	PRIMARY KEY (operation, key)
)
    """)
    op.execute("""
CREATE TABLE drinks (
	player_id UUID NOT NULL,
	stage_id UUID NOT NULL,
	name VARCHAR(60) NOT NULL,
	volume_ml NUMERIC(12, 6) NOT NULL,
	abv_percent NUMERIC(12, 6) NOT NULL,
	id UUID NOT NULL,
	seq BIGINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	deleted_at TIMESTAMP WITH TIME ZONE,
	row_version INTEGER NOT NULL,
	PRIMARY KEY (id),
	CHECK (volume_ml > 0 AND volume_ml <= 5000),
	CHECK (abv_percent BETWEEN 0 AND 100),
	FOREIGN KEY(player_id) REFERENCES players (id),
	FOREIGN KEY(stage_id) REFERENCES stages (id),
	UNIQUE (seq)
)
    """)
    op.execute("""
CREATE INDEX ix_drinks_stage_id ON drinks (stage_id)
    """)
    op.execute("""
CREATE INDEX ix_drinks_player_seq ON drinks (player_id, seq)
    """)
    op.execute("""
CREATE INDEX ix_drinks_player_id ON drinks (player_id)
    """)
    op.execute("""
CREATE TABLE matches (
	player_a_id UUID NOT NULL,
	player_b_id UUID NOT NULL,
	stage_id UUID NOT NULL,
	target INTEGER NOT NULL,
	score_a INTEGER NOT NULL,
	score_b INTEGER NOT NULL,
	snapshot_seq BIGINT NOT NULL,
	a_intoxication INTEGER,
	b_intoxication INTEGER,
	started_at TIMESTAMP WITH TIME ZONE,
	id UUID NOT NULL,
	seq BIGINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	deleted_at TIMESTAMP WITH TIME ZONE,
	row_version INTEGER NOT NULL,
	PRIMARY KEY (id),
	CHECK (player_a_id != player_b_id),
	CHECK (target IN (11, 21)),
	CHECK (score_a BETWEEN 0 AND 999 AND score_b BETWEEN 0 AND 999),
	CHECK (greatest(score_a, score_b) = greatest(target, least(score_a, score_b) + 2)),
	CHECK (snapshot_seq >= 0 AND snapshot_seq < seq),
	CHECK (a_intoxication BETWEEN 0 AND 10),
	CHECK (b_intoxication BETWEEN 0 AND 10),
	FOREIGN KEY(player_a_id) REFERENCES players (id),
	FOREIGN KEY(player_b_id) REFERENCES players (id),
	FOREIGN KEY(stage_id) REFERENCES stages (id),
	UNIQUE (seq)
)
    """)
    op.execute("""
CREATE INDEX ix_matches_player_b_id ON matches (player_b_id)
    """)
    op.execute("""
CREATE INDEX ix_matches_stage_id ON matches (stage_id)
    """)
    op.execute("""
CREATE INDEX ix_matches_player_a_id ON matches (player_a_id)
    """)
    op.execute(
        "INSERT INTO tournaments (id, title) VALUES "
        "('00000000-0000-0000-0000-000000000001', 'Alcohol Table Tennis')"
    )
    op.execute("INSERT INTO timeline_clock (id, last_seq, revision) VALUES (1, 0, 0)")
    op.execute(
        "INSERT INTO stages (id, seq, number, name, row_version) VALUES "
        "('00000000-0000-0000-0000-000000000002', 0, 0, 'Трезвые', 1)"
    )


def downgrade():
    for table in (
        "matches",
        "drinks",
        "stages",
        "players",
        "idempotency_records",
        "audit_log",
        "admin_sessions",
        "timeline_clock",
        "tournaments",
    ):
        op.drop_table(table)
