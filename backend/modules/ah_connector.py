"""
Albert Heijn JSON connector — structured data, no vision LLM needed.

AH's mobile-services API requires a short-lived anonymous bearer token
(the app fetches one silently on launch) before any product-search call
will return data — without it every endpoint responds 401 "Missing valid
security token". There is no public "bonus-only" endpoint; instead we page
through the regular product search (which AH's own app also uses for the
bonus shelf) and keep only products carrying bonus fields
(`bonusMechanism` / `discountType` / a lower `priceBeforeBonus`).

Community reference for the auth flow and endpoint shapes:
  https://github.com/Meithan/albert_heijn  (Python AH client)
  https://github.com/hmuralt/ah-api        (TypeScript)
"""
import logging
import re
from typing import List, Optional

import requests

from modules.date_utils import format_period
from modules.models import DealItem

logger = logging.getLogger(__name__)

_BASE = "https://api.ah.nl"
_AUTH_URL = f"{_BASE}/mobile-auth/v1/auth/token/anonymous"
_SEARCH_URL = f"{_BASE}/mobile-services/product/search/v2"

_HEADERS = {
    # Mimic the Appie mobile app so the API doesn't reject plain browser UAs
    "User-Agent": "Appie/8.22.3 (nl.ahold.albert.heijn; build:38850; iOS 16.3.1)",
    "Accept": "application/json",
    "x-application": "AHWEBSHOP",
}

_PAGE_SIZE = 1000
_MAX_PAGES = 10  # AH's search index caps out around 10k results regardless of query


# ── Auth ─────────────────────────────────────────────────────────────────────

def _get_anonymous_token() -> Optional[str]:
    try:
        resp = requests.post(_AUTH_URL, json={"clientId": "appie"}, timeout=15)
        resp.raise_for_status()
        return resp.json().get("access_token")
    except Exception as e:
        logger.debug(f"[AH] Anonymous auth failed: {e}")
        return None


# ── Parsing ────────────────────────────────────────────────────────────────────

def _parse_volume(text: str) -> tuple[Optional[int], Optional[str]]:
    if not text:
        return None, None
    m = re.search(
        r"(\d+(?:[.,]\d+)?)\s*(g|gr|gram|ml|l|liter|kg|stuks?|st\.?|pak|rol)",
        str(text), re.IGNORECASE
    )
    if not m:
        return None, None
    raw_val = float(m.group(1).replace(",", "."))
    unit = m.group(2).lower().rstrip(".")
    unit_map = {"gr": "gram", "g": "gram", "l": "liter", "st": "stuks", "pak": "stuks"}
    unit = unit_map.get(unit, unit)
    # Convert litres → ml if < 1 to keep inhoud_waarde as integer grams/ml
    if unit == "liter" and raw_val < 10:
        return int(raw_val * 1000), "ml"
    return int(raw_val), unit


def _parse_bonus_price(mechanism: str) -> Optional[float]:
    """Pull the deal price out of texts like 'VOOR 3.49' or '2 voor 3.99'."""
    if not mechanism:
        return None
    numbers = re.findall(r"(\d+[.,]\d{1,2})", mechanism)
    if not numbers:
        return None
    return float(numbers[-1].replace(",", "."))


def _is_bonus_item(product: dict) -> bool:
    return bool(product.get("bonusMechanism") or product.get("discountType"))


def _parse_item(product: dict) -> Optional[DealItem]:
    try:
        title = product.get("title") or product.get("name")
        if not title:
            return None

        mechanism = str(product.get("bonusMechanism") or "").strip()
        price = product.get("currentPrice")
        if price is None:
            price = _parse_bonus_price(mechanism)

        unit_size = product.get("salesUnitSize") or ""
        volume, unit = _parse_volume(str(unit_size))

        return DealItem(
            winkel="Albert Heijn",
            productnaam=str(title).strip(),
            korting_tekst=mechanism or None,
            actieprijs=float(price) if price is not None else None,
            inhoud_waarde=volume,
            inhoud_unit=unit,
            geldig_tekst=format_period(product.get("bonusStartDate"), product.get("bonusEndDate")),
        )
    except Exception as e:
        logger.debug(f"[AH] Item parse error: {e} — raw: {str(product)[:120]}")
        return None


# ── Public API ─────────────────────────────────────────────────────────────────

def fetch_ah_deals() -> List[DealItem]:
    """
    Fetch current AH bonus offers as structured DealItems.
    Returns an empty list (never raises) if the API is unavailable.
    """
    token = _get_anonymous_token()
    if not token:
        logger.warning("[AH] Could not obtain an anonymous access token — AH may have changed its auth flow.")
        return []

    headers = {**_HEADERS, "Authorization": f"Bearer {token}"}
    seen_ids = set()
    deals: List[DealItem] = []

    for page in range(_MAX_PAGES):
        try:
            resp = requests.get(
                _SEARCH_URL,
                headers=headers,
                params={"query": "", "size": _PAGE_SIZE, "page": page},
                timeout=30,
            )
            if resp.status_code != 200:
                logger.debug(f"[AH] search page {page} → {resp.status_code}")
                break

            data = resp.json()
            products = data.get("products") or []
            if not products:
                break

            for product in products:
                webshop_id = product.get("webshopId")
                if webshop_id is not None and webshop_id in seen_ids:
                    continue
                if not _is_bonus_item(product):
                    continue
                deal = _parse_item(product)
                if deal is not None:
                    deals.append(deal)
                    if webshop_id is not None:
                        seen_ids.add(webshop_id)

            if len(products) < _PAGE_SIZE:
                break  # last page
        except Exception as e:
            logger.debug(f"[AH] search page {page} error: {e}")
            break

    if not deals:
        logger.warning(
            "[AH] Authenticated but found no bonus items. Albert Heijn may have "
            "changed its search/bonus response shape — check https://github.com/Meithan/albert_heijn."
        )
    else:
        logger.info(f"[AH] {len(deals)} bonus deals found across up to {_MAX_PAGES} search pages")
    return deals
