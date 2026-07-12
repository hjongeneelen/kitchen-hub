"""
Dirk JSON connector — structured data, no vision LLM needed.

Dirk's aanbiedingen page (https://www.dirk.nl/aanbiedingen) is server-rendered
by Nuxt, and the full current-offers dataset for every category is embedded
directly in the page's `__NUXT_DATA__` payload — Nuxt's devalue-style
serialized state, not plain JSON. No separate API call or auth is needed;
this connector fetches the page once and decodes just the payload's "data"
node (its GraphQL API at web-gateway.dirk.nl exists but returns empty results
without a browser-set session; the embedded payload sidesteps that entirely).

We deliberately decode only the "data" branch of the payload, not the whole
thing — the "once"/"state" branches contain large, unrelated app state and
naively resolving every reference in them is combinatorially slow.
"""
import json
import logging
import re
from typing import Any, List, Optional

import requests

from modules.date_utils import format_period
from modules.models import DealItem

logger = logging.getLogger(__name__)

_OFFERS_URL = "https://www.dirk.nl/aanbiedingen"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
}
_REACTIVITY_TAGS = {"ShallowReactive", "Reactive", "Ref", "ShallowRef", "EmptyRef"}
_CONTAINER_TAGS = {"Set", "Map", "Date"}
_PAYLOAD_RE = re.compile(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', re.DOTALL)


class _NuxtPayload:
    """Minimal decoder for Nuxt's devalue-style __NUXT_DATA__ array format."""

    def __init__(self, arr: List[Any]):
        self._arr = arr
        self._cache: dict = {}

    def unwrap_ref(self, i: int) -> Any:
        """Follow a single reactivity-wrapper tag without recursing into its contents."""
        v = self._arr[i]
        if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and v[0] in _REACTIVITY_TAGS:
            return self.unwrap_ref(v[1])
        return v

    def resolve(self, i: int) -> Any:
        """Fully resolve the value at index i, following every nested reference."""
        if i in self._cache:
            return self._cache[i]
        self._cache[i] = None  # cycle guard for self-referential structures
        v = self._arr[i]
        if isinstance(v, dict):
            out = {k: self.resolve(idx) for k, idx in v.items()}
        elif isinstance(v, list):
            if len(v) == 2 and isinstance(v[0], str) and v[0] in (_REACTIVITY_TAGS | _CONTAINER_TAGS):
                tag, idx = v
                if tag in _REACTIVITY_TAGS:
                    out = self.resolve(idx)
                elif tag == "Set":
                    inner = self._arr[idx]
                    out = [self.resolve(x) for x in inner] if isinstance(inner, list) else []
                elif tag == "Map":
                    out = {str(self.resolve(k)): self.resolve(val) for k, val in self._arr[idx]}
                else:  # Date — the underlying ISO string is what we actually want
                    out = self.resolve(idx)
            else:
                out = [self.resolve(x) for x in v]
        else:
            out = v
        self._cache[i] = out
        return out


def _extract_payload_array(html: str) -> Optional[List[Any]]:
    m = _PAYLOAD_RE.search(html)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _parse_volume(text: str) -> tuple[Optional[int], Optional[str]]:
    if not text:
        return None, None
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(g|gr|gram|ml|l|liter|kg|stuks?|st\.?)", str(text), re.IGNORECASE)
    if not m:
        return None, None
    raw_val = float(m.group(1).replace(",", "."))
    unit = m.group(2).lower().rstrip(".")
    unit_map = {"gr": "gram", "g": "gram", "l": "liter", "st": "stuks"}
    unit = unit_map.get(unit, unit)
    if unit == "liter" and raw_val < 10:
        return int(raw_val * 1000), "ml"
    return int(raw_val), unit


def _parse_offer(offer: dict) -> Optional[DealItem]:
    try:
        title = offer.get("headerText")
        if not title:
            return None

        offer_price = offer.get("offerPrice")
        normal_price = offer.get("normalPrice") or 0
        if not normal_price:
            # Top-level normalPrice is often 0 for e.g. weekend-only specials —
            # fall back to the first linked product's own normal price.
            products = offer.get("products") or []
            if products:
                normal_price = products[0].get("normalPrice") or 0

        promo = None
        if normal_price and offer_price and normal_price > offer_price:
            promo = f"Van € {normal_price:.2f} voor € {offer_price:.2f}".replace(".", ",")

        volume, unit = _parse_volume(str(offer.get("packaging") or ""))

        return DealItem(
            winkel="Dirk",
            productnaam=str(title).strip(),
            korting_tekst=promo,
            actieprijs=float(offer_price) if offer_price is not None else None,
            inhoud_waarde=volume,
            inhoud_unit=unit,
            geldig_tekst=format_period(offer.get("startDate"), offer.get("endDate")),
        )
    except Exception as e:
        logger.debug(f"[Dirk] Item parse error: {e} — raw: {str(offer)[:120]}")
        return None


def fetch_dirk_deals() -> List[DealItem]:
    """
    Fetch current Dirk offers as structured DealItems.
    Returns an empty list (never raises) if the page/payload shape changes.
    """
    try:
        resp = requests.get(_OFFERS_URL, headers=_HEADERS, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"[Dirk] Could not fetch {_OFFERS_URL}: {e}")
        return []

    raw_array = _extract_payload_array(resp.text)
    if not raw_array:
        logger.warning("[Dirk] __NUXT_DATA__ payload not found — Dirk may have changed its page structure.")
        return []

    try:
        payload = _NuxtPayload(raw_array)
        root = payload.unwrap_ref(0)
        data_idx = root.get("data") if isinstance(root, dict) else None
        if data_idx is None:
            raise ValueError("no 'data' key in root payload")
        data_obj = payload.resolve(data_idx)
        key = next((k for k in data_obj if k.endswith("currentOffers")), None)
        if key is None:
            raise ValueError("no '*currentOffers' key in payload data")
        categories = data_obj[key] or []
    except Exception as e:
        logger.warning(f"[Dirk] Failed to decode __NUXT_DATA__ payload: {e}")
        return []

    deals: List[DealItem] = []
    for category in categories:
        for offer in category.get("currentOffers") or []:
            deal = _parse_offer(offer)
            if deal is not None:
                deals.append(deal)

    if not deals:
        logger.warning("[Dirk] Decoded payload but found no offers — check the page structure.")
    else:
        logger.info(f"[Dirk] {len(deals)} deals decoded from embedded page payload")
    return deals
