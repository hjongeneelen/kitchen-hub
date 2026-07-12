"""Shared helper for turning ISO start/end dates into a short Dutch validity string."""
from datetime import date, datetime, timedelta
from typing import Optional

_MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]


def _parse(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        return None


def format_period(start_iso: Optional[str], end_iso: Optional[str]) -> Optional[str]:
    """
    'geldig_tekst' for deals whose source gives clean ISO dates (AH, Dirk).
    Examples: '8 - 14 jul', '30 jun - 6 jul', 'vanaf 12 jul', 't/m 14 jul'.
    Endless-looking end dates (e.g. AH's 2999-12-31 sentinel, or >1 year out) are
    treated as "no real end date" rather than printed literally.
    """
    start = _parse(start_iso)
    end = _parse(end_iso)
    if end and (end - date.today()) > timedelta(days=365):
        end = None

    if start and end:
        if start.month == end.month:
            return f"{start.day} - {end.day} {_MONTHS[start.month - 1]}"
        return f"{start.day} {_MONTHS[start.month - 1]} - {end.day} {_MONTHS[end.month - 1]}"
    if start:
        return f"vanaf {start.day} {_MONTHS[start.month - 1]}"
    if end:
        return f"t/m {end.day} {_MONTHS[end.month - 1]}"
    return None
