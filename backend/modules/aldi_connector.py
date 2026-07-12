"""
Aldi DOM connector — structured data, no vision LLM needed.

Aldi's legacy REST API (webservice.aldi.nl) responds but returns empty
payloads, and its offers page's embedded __NEXT_DATA__ only has CMS/nav
metadata (the actual product grid is fetched client-side). So we drive a
real (headless) Chromium via Playwright to https://www.aldi.nl/aanbiedingen.html,
dismiss the cookie banner, and read the already-rendered product tiles
straight out of the DOM — cleanly structured, no OCR/vision needed.
"""
import logging
import re
from typing import List, Optional, Tuple

from modules.models import DealItem

logger = logging.getLogger(__name__)

_URL = "https://www.aldi.nl/aanbiedingen.html"
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_PRICE_RE = re.compile(r"\d+\.\d{2}")
_VOLUME_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(g|gr|gram|ml|l|liter|kg)\b", re.IGNORECASE)
_PER_STUK_RE = re.compile(r"per\s+(stuk|krop|bos|zak)", re.IGNORECASE)


def _parse_volume(text: str) -> Tuple[Optional[int], Optional[str]]:
    m = _VOLUME_RE.search(text)
    if m:
        raw_val = float(m.group(1).replace(",", "."))
        unit = m.group(2).lower()
        unit = {"gr": "gram", "g": "gram", "l": "liter"}.get(unit, unit)
        if unit == "liter" and raw_val < 10:
            return int(raw_val * 1000), "ml"
        return int(raw_val), unit
    if _PER_STUK_RE.search(text):
        return 1, "stuks"
    return None, None


def fetch_aldi_deals() -> List[DealItem]:
    """
    Fetch Aldi's current offers by rendering the page with a headless
    browser and reading the product tiles' DOM text directly.
    Returns an empty list (never raises) if Playwright/the page is unavailable.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.warning("[Aldi] Playwright not installed — run `pip install playwright` "
                        "and `playwright install chromium` to enable this connector.")
        return []

    deals: List[DealItem] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page(user_agent=_USER_AGENT)
                page.goto(_URL, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(3000)
                for label in ("Accepteer alles", "Alles accepteren", "Accepteren"):
                    try:
                        page.get_by_role("button", name=label).click(timeout=4000)
                        break
                    except Exception:
                        continue
                page.wait_for_timeout(2000)

                cards = page.locator(".product-tile").all()
                for card in cards:
                    try:
                        name_loc = card.locator(".product-tile__content__upper__product-name")
                        title = name_loc.first.inner_text().strip() if name_loc.count() else None
                        if not title:
                            continue

                        brand_loc = card.locator(".product-tile__content__upper__brand-name")
                        brand = brand_loc.first.inner_text().strip() if brand_loc.count() else ""
                        full_title = f"{brand} {title}".strip() if brand else title
                        full_title = full_title.replace("\xad", "")  # strip CSS soft-hyphen artifacts

                        full_text = card.inner_text()
                        prices = _PRICE_RE.findall(full_text)
                        price = float(prices[0]) if prices else None

                        volume, unit = _parse_volume(full_text)

                        promo = None
                        m = re.search(r"(-\d+%|OP=OP)", full_text)
                        if m:
                            promo = m.group(1)

                        deals.append(DealItem(
                            winkel="Aldi",
                            productnaam=full_title,
                            korting_tekst=promo,
                            actieprijs=price,
                            inhoud_waarde=volume,
                            inhoud_unit=unit,
                        ))
                    except Exception as e:
                        logger.debug(f"[Aldi] Card parse error: {e}")
            finally:
                browser.close()
    except Exception as e:
        logger.warning(f"[Aldi] Playwright render failed: {e}")
        return []

    if not deals:
        logger.warning("[Aldi] Rendered the page but found no product tiles — Aldi may have changed its layout.")
    else:
        logger.info(f"[Aldi] {len(deals)} deals read from the rendered page")
    return deals
