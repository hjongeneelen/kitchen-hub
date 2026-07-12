from typing import Optional

from pydantic import BaseModel, field_validator


class DealItem(BaseModel):
    winkel: str
    productnaam: str
    korting_tekst: Optional[str] = None
    actieprijs: Optional[float] = None
    inhoud_waarde: Optional[int] = None
    inhoud_unit: Optional[str] = None
    geldig_tekst: Optional[str] = None  # human-readable validity period, e.g. "8 - 14 jul" — free text since every store formats this differently
    categorie: Optional[str] = None  # assigned by modules/categorizer.py, e.g. "Groente & Fruit" — not set by the fetchers themselves

    @field_validator("winkel", "productnaam", mode="before")
    @classmethod
    def non_empty(cls, v: object) -> str:
        if not v or not str(v).strip():
            raise ValueError("Field cannot be empty")
        return str(v).strip()

    @field_validator("actieprijs", mode="before")
    @classmethod
    def parse_price(cls, v: object) -> Optional[float]:
        if v is None or v == "":
            return None
        if isinstance(v, str):
            cleaned = v.replace(",", ".").replace("€", "").replace(" ", "").strip()
            try:
                return float(cleaned)
            except ValueError:
                return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    @field_validator("inhoud_waarde", mode="before")
    @classmethod
    def parse_volume(cls, v: object) -> Optional[int]:
        if v is None or v == "":
            return None
        if isinstance(v, str):
            digits = "".join(filter(str.isdigit, v))
            return int(digits) if digits else None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    @field_validator("inhoud_unit", mode="before")
    @classmethod
    def normalize_unit(cls, v: object) -> Optional[str]:
        if v is None:
            return None
        v_lower = str(v).lower().strip()
        aliases = {
            "g": "gram", "gr": "gram", "grm": "gram",
            "milliliter": "ml", "milliliters": "ml",
            "kilogram": "kg", "kilo": "kg",
            "ltr": "liter", "l": "liter",
            "stuk": "stuks", "piece": "stuks", "pieces": "stuks",
        }
        return aliases.get(v_lower, v_lower)
