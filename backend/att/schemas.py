from decimal import Decimal
from typing import Annotated
from unicodedata import category, normalize
from uuid import UUID

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)

from .rules import MAX_POINTS, finished


def clean(value: str) -> str:
    value = normalize("NFKC", value)
    if any(category(char).startswith("C") for char in value):
        raise ValueError("Уберите управляющие символы")
    value = " ".join(value.split())
    if not value:
        raise ValueError("Введите название")
    return value


Name = Annotated[str, Field(min_length=1, max_length=60), AfterValidator(clean)]
Points = Annotated[int, Field(strict=True, ge=0, le=MAX_POINTS)]
Assessment = Annotated[int, Field(strict=True, ge=0, le=10)]
Sequence = Annotated[int, Field(strict=True, ge=0, le=2**53 - 1)]
Version = Annotated[int, Field(strict=True, gt=0)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlayerInput(Input):
    name: Annotated[str, Field(min_length=1, max_length=40), AfterValidator(clean)]

    @model_validator(mode="after")
    def normalized_length(self):
        if len(self.name) > 40:
            raise ValueError("Имя должно быть не длиннее 40 символов")
        return self


class DrinkInput(Input):
    player_id: UUID
    name: Name
    volume_ml: Annotated[Decimal, Field(gt=0, le=5000, decimal_places=6)]
    abv_percent: Annotated[Decimal, Field(ge=0, le=100, decimal_places=6)]

    @model_validator(mode="after")
    def normalized_length(self):
        if len(self.name) > 60:
            raise ValueError("Название должно быть не длиннее 60 символов")
        return self


class MatchInput(Input):
    player_a_id: UUID
    player_b_id: UUID
    target: Annotated[int, Field(strict=True)]
    score_a: Points
    score_b: Points
    snapshot_seq: Sequence
    a_intoxication: Assessment | None
    b_intoxication: Assessment | None
    started_at: AwareDatetime | None = None
    mode: Annotated[str, Field(pattern="^(quick|live)$")] = "quick"

    @model_validator(mode="after")
    def legal_match(self):
        if self.player_a_id == self.player_b_id:
            raise ValueError("Выберите двух разных игроков")
        if not finished(self.target, self.score_a, self.score_b):
            raise ValueError("Введите допустимый итоговый счёт с преимуществом в два очка")
        return self


class PlayerEdit(PlayerInput):
    row_version: Version
    archived: bool = False


class DrinkEdit(DrinkInput):
    row_version: Version


class MatchEdit(MatchInput):
    row_version: Version


class Revision(Input):
    row_version: Version


class Login(Input):
    password: Annotated[str, Field(min_length=1, max_length=256)]
