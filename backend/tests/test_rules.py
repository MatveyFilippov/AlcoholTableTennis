from decimal import Decimal

import pytest

from att.projection import BINS, bucket, group_stats
from att.rules import elo, ethanol, finished


@pytest.mark.parametrize(
    "target,scores",
    [
        (11, [(11, 0), (11, 9), (12, 10), (13, 11)]),
        (21, [(21, 0), (21, 19), (22, 20), (23, 21)]),
    ],
)
def test_legal_scores(target, scores):
    for a, b in scores:
        assert finished(target, a, b)
        assert finished(target, b, a)


@pytest.mark.parametrize(
    "target,a,b",
    [
        (11, 11, 10),
        (11, 12, 9),
        (11, 13, 10),
        (11, 14, 11),
        (11, 15, 11),
        (11, 10, 10),
        (11, 0, 0),
        (11, -1, 11),
        (11, 1000, 998),
        (21, 21, 20),
        (21, 22, 18),
        (21, 23, 19),
        (21, 20, 20),
        (15, 15, 0),
    ],
)
def test_illegal_scores(target, a, b):
    assert not finished(target, a, b)
    assert not finished(target, b, a)


def test_elo_golden():
    assert elo(1000, 1000, 1) == (1016, 984, 0.5)
    assert elo(1000, 1000, 0) == (984, 1016, 0.5)
    a, b, expected = elo(1000, 1200, 1)
    assert (a, b, expected) == pytest.approx(
        (1024.3119016527347, 1175.6880983472653, 0.2402530733520421)
    )
    assert a + b == pytest.approx(2200)


def test_ethanol_and_missing_data():
    assert ethanol(Decimal(500), Decimal(5)) == Decimal("19.725")
    assert ethanol(Decimal(100), Decimal(40)) == Decimal("31.56")
    assert ethanol(Decimal(500), Decimal(0)) == 0
    assert tuple(map(bucket, [0, 3, 6, 10, None])) == BINS
    assert group_stats([])["win_rate"] is None
    assert group_stats([{"actual": 1, "expected": 0.5, "residual": 0.5}])["residual"] == 0.5
