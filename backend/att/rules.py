from decimal import Decimal
from math import exp, log

MAX_POINTS = 999


def finished(target: int, a: int, b: int) -> bool:
    winner, loser = max(a, b), min(a, b)
    return (
        target in (11, 21)
        and 0 <= loser < winner <= MAX_POINTS
        and winner == max(target, loser + 2)
    )


def ethanol(volume: Decimal, abv: Decimal) -> Decimal:
    return volume * abv * Decimal("0.00789")


def elo(a: float, b: float, actual: int) -> tuple[float, float, float]:
    difference = (b - a) * log(10) / 400
    if difference > 0:
        inverse = exp(-difference)
        expected = inverse / (1 + inverse)
    else:
        expected = 1 / (1 + exp(difference))
    delta = 32 * (actual - expected)
    return a + delta, b - delta, expected
