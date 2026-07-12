"""
supermarktscanner.nl connector — a live, per-keyword price-comparison lookup,
NOT a full catalog scrape. Used as a fallback source for ingredient matching
(modules/ingredient_matcher.py) when our own scraped store deals have zero or
few matches for a given ingredient — supermarktscanner.nl already aggregates
current prices across many Dutch supermarkets, so a single lookup there can
surface cross-store coverage we don't otherwise have.

DOM notes (confirmed 2026-07 by rendering
https://www.supermarktscanner.nl/product.php?keyword=... with Playwright and
inspecting the page source — no bot-block, plain server-rendered HTML):
  <li class="product-entry" data-name="...">
    <span class="shoplogo"><img src="/img/shops_logo/hoogvliet_tag.png"></span>
    <div class="pgprice">0.88</div>                 <!-- price -->
    <div class="pgkgprice">(<strong>4.00</strong>/kg)</div>  <!-- per-kg/l, unused here -->
    <div class="product-name">Fresca Dor Mozzarella</div>
    <span class="cbp-pgprice">220 gram</span>        <!-- pack size -->
  </li>
The very first <li> in the grid is a "sorted by price per kilo" filler card
with no `product-entry` class, so scoping the selector to `li.product-entry`
already excludes it.

robots.txt (checked 2026-07) disallows /inloggen, /out/, /naar-supermarkt/,
and a couple of tracking-param patterns — /product.php is NOT disallowed.

Same defensive style as modules/jumbo_connector.py: headless Chromium,
domcontentloaded + a short settle timeout, everything wrapped so this never
raises — a failed lookup just means an empty list, not a broken pipeline.
"""
import logging
import re
from typing import List, Optional, Tuple
from urllib.parse import quote

logger = logging.getLogger(__name__)

_BASE = "https://www.supermarktscanner.nl"
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_NAV_TIMEOUT_MS = 30000
_SETTLE_TIMEOUT_MS = 2000

_VOLUME_RE = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(gram|gr|g|kilogram|kilo|kg|milliliter|ml|liter|ltr|l|stuk|stuks)\b",
    re.IGNORECASE,
)
_UNIT_MAP = {
    "gr": "gram", "g": "gram",
    "kilogram": "kg", "kilo": "kg",
    "milliliter": "ml",
    "ltr": "liter", "l": "liter",
    "stuk": "stuks",
}

# Known shop-logo filename codes -> display name. Falls back to a title-cased
# guess (e.g. "jan-linders" -> "Jan Linders") for any code not listed here, so
# an unrecognised store still produces a usable (if imperfect) name rather
# than None.
_SHOP_NAMES = {
    "ah": "Albert Heijn",
    "aldi": "Aldi",
    "dirk": "Dirk",
    "jumbo": "Jumbo",
    "plus": "Plus",
    "hoogvliet": "Hoogvliet",
    "dekamarkt": "Dekamarkt",
    "vomar": "Vomar",
    "lidl": "Lidl",
    "coop": "Coop",
    "spar": "Spar",
    "poiesz": "Poiesz",
    "boni": "Boni",
    "deen": "Deen",
    "nettorama": "Nettorama",
    "jan-linders": "Jan Linders",
}


def _shop_from_logo_src(src: str) -> Optional[str]:
    """'/img/shops_logo/hoogvliet_tag.png' -> 'Hoogvliet'."""
    if not src:
        return None
    filename = src.rsplit("/", 1)[-1]
    code = re.sub(r"\.(png|jpe?g|svg|webp)$", "", filename, flags=re.IGNORECASE)
    code = re.sub(r"_(tag|small|large|logo)$", "", code, flags=re.IGNORECASE)
    if not code:
        return None
    return _SHOP_NAMES.get(code.lower(), code.replace("_", " ").replace("-", " ").title())


def _parse_size(text: str) -> Tuple[Optional[int], Optional[str]]:
    if not text:
        return None, None
    m = _VOLUME_RE.search(text)
    if not m:
        return None, None
    val = float(m.group(1).replace(",", "."))
    unit = _UNIT_MAP.get(m.group(2).lower(), m.group(2).lower())
    if unit == "kg":
        val *= 1000
        unit = "gram"
    if unit == "liter":
        val *= 1000
        unit = "ml"
    return int(round(val)), unit


def _parse_price(text: str) -> Optional[float]:
    if not text:
        return None
    m = re.search(r"\d+(?:[.,]\d+)?", text.strip())
    return float(m.group().replace(",", ".")) if m else None


def fetch_ingredient_prices(keyword: str) -> List[dict]:
    """
    Render supermarktscanner.nl's product-comparison page for one keyword and
    read each listed product row straight out of the DOM (price, per-kg/l
    price, name, pack size, and the supermarket the row belongs to, when
    determinable from its logo image).

    This is a single live lookup, not a catalog scrape — call it sparingly,
    once per distinct ingredient keyword (dedupe upstream), only as a
    fallback for ingredients that got weak/no matches against our own scraped
    deal data. Never raises: returns [] if Playwright is missing, the site is
    unreachable, or its layout has changed underneath us.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.warning(
            "[supermarktscanner] Playwright not installed — run `pip install playwright` "
            "and `playwright install chromium` to enable this connector."
        )
        return []

    if not keyword or not keyword.strip():
        return []

    url = f"{_BASE}/product.php?keyword={quote(keyword.strip())}"
    results: List[dict] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page(user_agent=_USER_AGENT, viewport={"width": 1280, "height": 900})
                page.goto(url, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT_MS)
                page.wait_for_timeout(_SETTLE_TIMEOUT_MS)

                for row in page.locator("li.product-entry").all():
                    try:
                        name_loc = row.locator(".product-name").first
                        if not name_loc.count():
                            continue
                        name = name_loc.inner_text().strip()
                        if not name:
                            continue

                        price_loc = row.locator(".pgprice").first
                        price = _parse_price(price_loc.inner_text()) if price_loc.count() else None

                        size_loc = row.locator(".cbp-pgprice").first
                        volume, unit = _parse_size(size_loc.inner_text()) if size_loc.count() else (None, None)

                        winkel = None
                        logo_loc = row.locator(".shoplogo img").first
                        if logo_loc.count():
                            winkel = _shop_from_logo_src(logo_loc.get_attribute("src") or "")

                        results.append({
                            "winkel": winkel,
                            "productnaam": name,
                            "actieprijs": price,
                            "inhoud_waarde": volume,
                            "inhoud_unit": unit,
                            "bron": "supermarktscanner.nl",
                        })
                    except Exception as e:
                        logger.debug(f"[supermarktscanner] Row parse error for '{keyword}': {e}")
            finally:
                browser.close()
    except Exception as e:
        logger.warning(f"[supermarktscanner] Lookup failed for keyword '{keyword}': {e}")
        return []

    logger.info(f"[supermarktscanner] '{keyword}': {len(results)} rows read")
    return results
