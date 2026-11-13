from bisect import bisect_right
from collections import Counter, defaultdict
from decimal import Decimal
from statistics import mean
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Drink, Match, Player, Tournament, TOURNAMENT_ID
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


def compare_halves(observations: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(observations)
    if n < 4:
        return {"n": n, "omitted": 0, "start": None, "end": None, "delta": None}

    def summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
        return {**group_stats(rows), "mean_ethanol_g": mean(o["ethanol_g"] for o in rows)}

    k = n // 2
    start, end = summary(observations[:k]), summary(observations[-k:])
    return {
        "n": n,
        "omitted": n % 2,
        "start": start,
        "end": end,
        "delta": end["residual"] - start["residual"],
    }


def comparison_order(players: list[dict[str, Any]]) -> list[str]:
    eligible = (p for p in players if p["comparison"]["delta"] is not None)
    return [
        p["id"]
        for p in sorted(
            eligible, key=lambda p: (p["comparison"]["delta"], p["name"].casefold(), p["id"])
        )
    ]


def evening_facts(matches: list[dict[str, Any]]) -> dict[str, Any]:
    pairs = Counter(tuple(sorted((m["player_a_id"], m["player_b_id"]))) for m in matches)
    top = pairs.most_common(2)
    frequent = None
    if top and top[0][1] >= 2 and (len(top) == 1 or top[0][1] > top[1][1]):
        frequent = {"players": top[0][0], "n": top[0][1]}
    margins = sorted(matches, key=lambda m: (abs(m["score_a"] - m["score_b"]), m["seq"]))
    tightest = None
    if len(margins) >= 2:
        first, second = margins[:2]
        if abs(first["score_a"] - first["score_b"]) < abs(second["score_a"] - second["score_b"]):
            tightest = first["id"]
    return {"frequent_pair": frequent, "tightest_match_id": tightest}


def project(db: Session) -> dict[str, Any]:
    timeline = clock(db)
    players = {
        str(p.id): {
            **record(p),
            "elo": 1000.0,
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
        actual = int(match.score_a > match.score_b)
        a_elo, b_elo, expected = elo(a["elo"], b["elo"], actual)
        entry = {
            **record(match),
            "winner_id": a["id"] if actual else b["id"],
        }
        for side, player, opponent, result, probability, after, amount, rating in (
            ("a", a, b, actual, expected, a_elo, a_g, match.a_intoxication),
            ("b", b, a, 1 - actual, 1 - expected, b_elo, b_g, match.b_intoxication),
        ):
            observation = {
                "match_id": str(match.id),
                "seq": match.seq,
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
        matches.append(entry)

    for id, player in players.items():
        observations = player["observations"]
        player.update(
            group_stats(observations),
            ethanol_g=float(at(id, timeline.last_seq)),
            volume_ml=float(volumes[id]),
            preliminary=0 < len(observations) < 5,
            elo_delta=player["elo"] - 1000,
            comparison=compare_halves(observations),
        )
    standings = sorted(
        players.values(), key=lambda p: (not p["n"], -p["elo"], p["name"].casefold(), p["id"])
    )
    for rank, player in enumerate(standings, 1):
        player["rank"] = rank if player["n"] else None
    tournament = db.get(Tournament, TOURNAMENT_ID)
    assert tournament is not None
    activity = max((r["created_at"] for r in [*standings, *matches, *drinks]), default=None)
    return {
        "tournament": record(tournament),
        "snapshot_seq": timeline.last_seq,
        "projection_version": f"{timeline.last_seq}.{timeline.revision}",
        "players": standings,
        "matches": matches[::-1],
        "drinks": drinks[::-1],
        "last_activity": activity,
        "comparison_order": comparison_order(standings),
        "facts": evening_facts(matches),
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
        "opponents": [
            {"id": id, **group_stats([o for o in observations if o["opponent_id"] == id])}
            for id in dict.fromkeys(o["opponent_id"] for o in observations)
        ],
    }
