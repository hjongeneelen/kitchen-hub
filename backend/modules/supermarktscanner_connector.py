"""
supermarktscanner.nl connector — the site is now the app's ONLY deals source
(no more per-store scraping of Albert Heijn/Lidl/Dirk/Jumbo/Plus/Aldi, and no
more PDF+vision-LLM pipeline for the other stores). Two entry points:

  fetch_deals_overview() — scrapes /beste-supermarkt-aanbiedingen, a curated
    "best deals this week" grid spanning many Dutch supermarkets at once.
    This is the primary source for the /deals page (see main.py).

  fetch_ingredient_prices(keyword) — a live, per-keyword price-comparison
    lookup against /product.php?keyword=..., NOT a full catalog scrape. Used
    by modules/ingredient_matcher.py to fill in ingredients that got weak/no
    matches from the (now much smaller) deals-overview data.

Both read the exact same `li.product-entry` markup — the deals-overview page
turned out to reuse the identical product-card template, just with extra
discount/validity chrome:
  <li class="product-entry" data-name="..." data-freq="rarely">
    <span class="shoplogo"><img src="/img/shops_logo/hoogvliet.png"></span>
    <span class="discountTag tag-rarely">Zeldzaam</span>
    <div class="pgprice"><span class="pgpricediscount">1.99 </span>0.49</div>
    <div class="discount-badge-container"><span class="discount-badge">-75% KORTING</span></div>
    <div class="pgdiscountdate">(aanbieding is 15 juli t/m 21 juli)</div>
    <div class="product-name">Bar le Duc Mineraalwater kzh 4pk</div>
    <span class="cbp-pgprice">2 liter</span>
  </li>
`.pgprice` on a discounted item holds BOTH prices as one text node — the
original price inside `.pgpricediscount`, the sale price as bare trailing
text after it (not its own element) — so the sale price has to be recovered
by stripping the original-price substring from the full `.pgprice` text (see
`_parse_deal_price`). Confirmed 2026-07 by rendering both pages with
Playwright and inspecting the raw page source — no bot-block, plain
server-rendered HTML, no pagination/infinite-scroll on the overview page
(~80 curated deals, static list).

robots.txt (checked 2026-07) disallows /inloggen, /out/, /naar-supermarkt/,
and a couple of tracking-param patterns — neither /product.php nor
/beste-supermarkt-aanbiedingen is disallowed.

Same defensive style as the old per-store connectors this replaces: headless
Chromium, domcontentloaded + a short settle timeout, everything wrapped so a
failed scrape means an empty list, not a broken pipeline.
"""
import logging
import re
from typing import List, Optional, Tuple
from urllib.parse import quote

from modules.models import DealItem

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


_OVERVIEW_URL = f"{_BASE}/beste-supermarkt-aanbiedingen"


_STRIP_DISCOUNT_SPAN_JS = """el => {
    const clone = el.cloneNode(true);
    const original = clone.querySelector('.pgpricediscount');
    if (original) original.remove();
    return clone.textContent.trim();
}"""


def _parse_deal_price(row) -> Optional[float]:
    """Discounted items render both prices in one `.pgprice` node — the
    original price inside a nested `.pgpricediscount` span, the sale price as
    bare trailing text after it (not its own element, so it can't be
    selected directly). Removing the `.pgpricediscount` span from a clone of
    the node and reading what's left is far more reliable than string-
    subtracting the original price's text out of the combined text (which
    would silently keep the wrong — original — price on any whitespace
    mismatch between the two reads). Falls back to parsing the whole node as
    one price for a row with no `.pgpricediscount` span (i.e. not currently
    discounted)."""
    price_loc = row.locator(".pgprice").first
    if not price_loc.count():
        return None
    try:
        remainder = price_loc.evaluate(_STRIP_DISCOUNT_SPAN_JS)
    except Exception:
        remainder = None
    if remainder:
        price = _parse_price(remainder)
        if price is not None:
            return price
    return _parse_price(price_loc.inner_text())


def _parse_discount_text(row) -> Optional[str]:
    badge_loc = row.locator(".discount-badge").first
    if not badge_loc.count():
        return None
    text = " ".join(badge_loc.inner_text().split())
    return text or None


def _parse_validity_text(row) -> Optional[str]:
    date_loc = row.locator(".pgdiscountdate").first
    if not date_loc.count():
        return None
    text = date_loc.inner_text().strip().strip("()")
    return text or None


def fetch_deals_overview() -> List[DealItem]:
    """
    Render supermarktscanner.nl's curated "beste supermarkt aanbiedingen"
    (best deals this week) page and read every listed deal straight out of
    the DOM. This is the app's ONLY deals source — it replaces what used to
    be 6 separate per-store connectors (Albert Heijn/Lidl/Dirk/Jumbo/Plus/
    Aldi) plus an 11-store PDF+vision-LLM pipeline for every other store.

    The page is a curated "best deals" selection (~80 items spanning many
    stores at once, no pagination or infinite scroll) rather than a full
    per-store catalog — expect far fewer items per store than the old
    per-store scrapers used to return. Never raises: returns [] if
    Playwright is missing, the site is unreachable, or its layout has
    changed underneath us.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.warning(
            "[supermarktscanner] Playwright not installed — run `pip install playwright` "
            "and `playwright install chromium` to enable this connector."
        )
        return []

    results: List[DealItem] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page(user_agent=_USER_AGENT, viewport={"width": 1280, "height": 900})
                page.goto(_OVERVIEW_URL, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT_MS)
                page.wait_for_timeout(_SETTLE_TIMEOUT_MS)

                for row in page.locator("li.product-entry").all():
                    try:
                        name_loc = row.locator(".product-name").first
                        if not name_loc.count():
                            continue
                        name = name_loc.inner_text().strip()
                        if not name:
                            continue

                        logo_loc = row.locator(".shoplogo img").first
                        winkel = (
                            _shop_from_logo_src(logo_loc.get_attribute("src") or "")
                            if logo_loc.count()
                            else None
                        )
                        if not winkel:
                            continue

                        size_loc = row.locator(".cbp-pgprice").first
                        volume, unit = _parse_size(size_loc.inner_text()) if size_loc.count() else (None, None)

                        results.append(
                            DealItem(
                                winkel=winkel,
                                productnaam=name,
                                korting_tekst=_parse_discount_text(row),
                                actieprijs=_parse_deal_price(row),
                                inhoud_waarde=volume,
                                inhoud_unit=unit,
                                geldig_tekst=_parse_validity_text(row),
                            )
                        )
                    except Exception as e:
                        logger.debug(f"[supermarktscanner] Row parse error on deals overview: {e}")
            finally:
                browser.close()
    except Exception as e:
        logger.warning(f"[supermarktscanner] Deals-overview scrape failed: {e}")
        return []

    logger.info(f"[supermarktscanner] Deals overview: {len(results)} deals read")
    return results


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
