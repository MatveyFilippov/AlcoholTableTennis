from bisect import bisect_right
from collections import defaultdict
from decimal import Decimal
from statistics import mean, median
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Drink, Match, Player, Stage, Tournament, TOURNAMENT_ID
from .rules import elo, ethanol
from .service import clock, record

ZERO = Decimal(0)
BINS = ("0", "1–3", "4–6", "7–10", "Неизвестно")


def bucket(value: int | None) -> str:
    if value is None:
        return BINS[4]
    return BINS[0 if value == 0 else 1 if value < 4 else 2 if value < 7 else 3]


def group_stats(observations: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(observations)
    wins = sum(o["actual"] for o in observations)
    return {
        "n": n,
        "wins": wins,
        "losses": n - wins,
        "win_rate": wins / n if n else None,
        "expected": mean(o["expected"] for o in observations) if n else None,
        "residual": mean(o["residual"] for o in observations) if n else None,
    }


def project(db: Session) -> dict[str, Any]:
    timeline = clock(db)
    stages = [
        record(s)
        for s in db.scalars(select(Stage).where(Stage.deleted_at.is_(None)).order_by(Stage.seq))
    ]
    players = {
        str(p.id): {
            **record(p),
            "elo": 1000.0,
            "sober_elo": 1000.0,
            "sober_matches": 0,
            "ethanol_g": 0.0,
            "volume_ml": 0.0,
            "observations": [],
        }
        for p in db.scalars(select(Player).where(Player.deleted_at.is_(None)))
    }
    drink_seqs: dict[str, list[int]] = defaultdict(list)
    grams: dict[str, list[Decimal]] = defaultdict(list)
    volumes: dict[str, Decimal] = defaultdict(Decimal)
    drinks = []
    for drink in db.scalars(select(Drink).where(Drink.deleted_at.is_(None)).order_by(Drink.seq)):
        player = str(drink.player_id)
        amount = ethanol(drink.volume_ml, drink.abv_percent)
        drink_seqs[player].append(drink.seq)
        previous = grams[player][-1] if grams[player] else ZERO
        grams[player].append(previous + amount)
        volumes[player] += drink.volume_ml
        drinks.append(
            {
                **record(drink),
                "ethanol_g": float(amount),
                "cumulative_g": float(previous + amount),
                "cumulative_ml": float(volumes[player]),
            }
        )

    def at(player: str, seq: int) -> Decimal:
        index = bisect_right(drink_seqs[player], seq)
        return grams[player][index - 1] if index else ZERO

    matches = []
    for match in db.scalars(select(Match).where(Match.deleted_at.is_(None)).order_by(Match.seq)):
        a, b = players[str(match.player_a_id)], players[str(match.player_b_id)]
        a_g, b_g = at(a["id"], match.snapshot_seq), at(b["id"], match.snapshot_seq)
        sober = match.a_intoxication == match.b_intoxication == 0 and a_g == b_g == 0
        actual = int(match.score_a > match.score_b)
        a_elo, b_elo, expected = elo(a["elo"], b["elo"], actual)
        entry = {
            **record(match),
            "winner_id": a["id"] if actual else b["id"],
            "sober": sober,
        }
        for side, player, opponent, result, probability, after, amount, rating in (
            ("a", a, b, actual, expected, a_elo, a_g, match.a_intoxication),
            ("b", b, a, 1 - actual, 1 - expected, b_elo, b_g, match.b_intoxication),
        ):
            observation = {
                "match_id": str(match.id),
                "seq": match.seq,
                "stage_id": str(match.stage_id),
                "opponent_id": opponent["id"],
                "actual": result,
                "expected": probability,
                "residual": result - probability,
                "ethanol_g": float(amount),
                "self_rating": rating,
                "elo_before": player["elo"],
                "elo_after": after,
            }
            player["elo"] = after
            player["observations"].append(observation)
            entry[side] = observation
        if sober:
            a["sober_elo"], b["sober_elo"], _ = elo(a["sober_elo"], b["sober_elo"], actual)
            a["sober_matches"] += 1
            b["sober_matches"] += 1
            entry["a"]["sober_elo_after"] = a["sober_elo"]
            entry["b"]["sober_elo_after"] = b["sober_elo"]
        matches.append(entry)

    for id, player in players.items():
        observations = player["observations"]
        player.update(
            group_stats(observations),
            ethanol_g=float(at(id, timeline.last_seq)),
            volume_ml=float(volumes[id]),
            preliminary=0 < len(observations) < 5,
            elo_delta=player["elo"] - 1000,
        )
        if not player["sober_matches"]:
            player["sober_elo"] = None
    standings = sorted(
        players.values(), key=lambda p: (not p["n"], -p["elo"], p["name"].casefold(), p["id"])
    )
    sober_standings = sorted(
        (p for p in standings if p["sober_matches"]),
        key=lambda p: (-p["sober_elo"], p["name"].casefold(), p["id"]),
    )
    for rank, player in enumerate(standings, 1):
        player["rank"] = rank if player["n"] else None
        player["sober_rank"] = None
    for rank, player in enumerate(sober_standings, 1):
        player["sober_rank"] = rank

    for stage in stages:
        stage_matches = [m for m in matches if m["stage_id"] == stage["id"]]
        ratings = [
            m[key]
            for m in stage_matches
            for key in ("a_intoxication", "b_intoxication")
            if m[key] is not None
        ]
        stage.update(
            matches=len(stage_matches),
            assessments=len(ratings),
            mean_rating=mean(ratings) if ratings else None,
            median_rating=median(ratings) if ratings else None,
            ethanol_g=sum(d["ethanol_g"] for d in drinks if d["stage_id"] == stage["id"]),
        )
    tournament = db.get(Tournament, TOURNAMENT_ID)
    assert tournament is not None
    activity = max(
        (r["created_at"] for r in [*standings, *stages[1:], *matches, *drinks]), default=None
    )
    return {
        "tournament": record(tournament),
        "current_stage": stages[-1],
        "stages": stages,
        "snapshot_seq": timeline.last_seq,
        "projection_version": f"{timeline.last_seq}.{timeline.revision}",
        "players": standings,
        "matches": matches[::-1],
        "drinks": drinks[::-1],
        "last_activity": activity,
    }


def profile(state: dict[str, Any], player: dict[str, Any]) -> dict[str, Any]:
    observations = player["observations"]
    return {
        **player,
        "drinks": [d for d in state["drinks"] if d["player_id"] == player["id"]],
        "matches": [
            m for m in state["matches"] if player["id"] in (m["player_a_id"], m["player_b_id"])
        ],
        "bins": [
            {
                "label": label,
                **group_stats([o for o in observations if bucket(o["self_rating"]) == label]),
            }
            for label in BINS
        ],
        "stages": [
            {"id": s["id"], **group_stats([o for o in observations if o["stage_id"] == s["id"]])}
            for s in state["stages"]
        ],
        "opponents": [
            {"id": id, **group_stats([o for o in observations if o["opponent_id"] == id])}
            for id in dict.fromkeys(o["opponent_id"] for o in observations)
        ],
    }
