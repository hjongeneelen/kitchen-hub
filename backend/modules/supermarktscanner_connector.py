"""
supermarktscanner.nl connector — two things live here:

1. fetch_ingredient_prices(keyword) — a live, per-keyword price-comparison
   lookup, NOT a full catalog scrape. Used as a fallback source for
   ingredient matching (modules/ingredient_matcher.py) when our own scraped
   store deals have zero or few matches for a given ingredient.
2. fetch_store_deals(slug, store_name) — a per-store weekly-deals scrape of
   supermarktscanner.nl's own `/{slug}-aanbiedingen` pages. This exists
   because supermarktscanner.nl mirrors several retailers' weekly folders
   that we otherwise only have a vision-LLM (Ollama-only, CI-unfriendly)
   path for — confirmed working for Hoogvliet and Poiesz (see main.py's
   STORES registry). Same DOM, same no-LLM-needed Playwright approach as (1).

DOM notes (confirmed 2026-07 by rendering
https://www.supermarktscanner.nl/product.php?keyword=... and
https://www.supermarktscanner.nl/hoogvliet-aanbiedingen with Playwright and
inspecting the page source — no bot-block, plain server-rendered HTML):
  <li class="product-entry" data-name="...">
    <span class="shoplogo"><img src="/img/shops_logo/hoogvliet_tag.png"></span>
    <div class="pgprice">0.88</div>                 <!-- price; on a discounted
      item this is instead <div class="pgprice"><span class="pgpricediscount">
      1.99 </span>0.49</div> — the span holds the "was" price, the trailing
      text node the current one -->
    <div class="pgkgprice">(<strong>4.00</strong>/kg)</div>  <!-- per-kg/l, unused here -->
    <div class="pgdiscountdate">(aanbieding is 15 juli t/m 21 juli)</div>  <!-- validity period, deals pages only -->
    <div class="cbp-pgitem-flip">
      <img class="copyright-img" src="/img/shops_logo/hoogvliet_light_gray.png">  <!-- NOT the product photo -->
      <a ...><img src="https://cdn.hoogvliet.com/.../730400000.jpg" data-lazy="...same-or-real-url..."></a>  <!-- the actual product photo; lazy-loaded pages put the real URL in data-lazy and a 1x1 placeholder in src -->
    </div>
    <div class="product-name">Fresca Dor Mozzarella</div>
    <span class="cbp-pgprice">220 gram</span>        <!-- pack size -->
  </li>
The very first <li> in the grid is a "sorted by price per kilo" filler card
with no `product-entry` class, so scoping the selector to `li.product-entry`
already excludes it.

robots.txt (checked 2026-07) disallows /inloggen, /out/, /naar-supermarkt/,
and a couple of tracking-param patterns — /product.php and /{slug}-aanbiedingen
are NOT disallowed.

Same defensive style as modules/jumbo_connector.py: headless Chromium,
domcontentloaded + a short settle timeout, everything wrapped so this never
raises — a failed lookup just means an empty list, not a broken pipeline.
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


def _read_price(price_loc) -> Tuple[Optional[float], Optional[str]]:
    """Returns (current_price, korting_tekst) from a `.pgprice` locator.
    Plain: "<div class='pgprice'>0.88</div>" -> (0.88, None).
    Discounted: "<div class='pgprice'><span class='pgpricediscount'>1.99 </span>0.49</div>"
    -> (0.49, "was €1,99") — the span holds the "was" price, the div's own
    trailing text node the current one. Getting this wrong (e.g. a naive
    "first number in the text" parse) would silently report the pre-discount
    price as actieprijs on any discounted row."""
    if not price_loc.count():
        return None, None
    full_text = price_loc.inner_text()
    discount_loc = price_loc.locator(".pgpricediscount")
    if discount_loc.count():
        original_text = discount_loc.first.inner_text()
        original_price = _parse_price(original_text)
        current_price = _parse_price(full_text.replace(original_text, "", 1))
        korting_tekst = f"was €{original_text.strip().replace('.', ',')}" if original_price is not None else None
        return current_price, korting_tekst
    return _parse_price(full_text), None


def _read_image_url(row) -> Optional[str]:
    """The product photo lives in `.cbp-pgitem-flip img` alongside a
    `.copyright-img` shop-watermark we must exclude. Lazy-loaded rows carry
    the real CDN URL in `data-lazy` and a 1x1 placeholder in `src`; loaded
    rows have the same real URL in both — preferring data-lazy handles both."""
    img_loc = row.locator(".cbp-pgitem-flip img:not(.copyright-img)").first
    if not img_loc.count():
        return None
    url = img_loc.get_attribute("data-lazy") or img_loc.get_attribute("src")
    if not url or "pixel.webp" in url:
        return None
    return url


def _read_geldig_tekst(row) -> Optional[str]:
    """Validity period, e.g. "(aanbieding is 15 juli t/m 21 juli)" — only
    present on the per-store deals pages, not on a product.php keyword search."""
    loc = row.locator(".pgdiscountdate").first
    if not loc.count():
        return None
    text = loc.inner_text().strip().strip("()").strip()
    return text or None


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
                        price, _korting_tekst = _read_price(price_loc)

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
                            "afbeelding_url": _read_image_url(row),
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


def fetch_store_deals(slug: str, store_name: str) -> List[DealItem]:
    """
    Render supermarktscanner.nl's own `/{slug}-aanbiedingen` page for one
    store and read every listed deal straight out of the DOM. This is how we
    get Hoogvliet/Poiesz (and could get any other store supermarktscanner.nl
    dedicates a page to) into the daily CI scrape without a vision LLM —
    confirmed working DOM shape, same connector style as fetch_ingredient_prices.
    Never raises: returns [] if Playwright is missing, the page 404s, or the
    site's layout has changed underneath us.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.warning(
            f"[supermarktscanner:{slug}] Playwright not installed — run `pip install playwright` "
            "and `playwright install chromium` to enable this connector."
        )
        return []

    url = f"{_BASE}/{slug}-aanbiedingen"
    deals: List[DealItem] = []
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
                        price, korting_tekst = _read_price(price_loc)

                        size_loc = row.locator(".cbp-pgprice").first
                        volume, unit = _parse_size(size_loc.inner_text()) if size_loc.count() else (None, None)

                        deals.append(DealItem(
                            winkel=store_name,
                            productnaam=name,
                            korting_tekst=korting_tekst,
                            actieprijs=price,
                            inhoud_waarde=volume,
                            inhoud_unit=unit,
                            geldig_tekst=_read_geldig_tekst(row),
                            afbeelding_url=_read_image_url(row),
                        ))
                    except Exception as e:
                        logger.debug(f"[supermarktscanner:{slug}] Row parse error: {e}")
            finally:
                browser.close()
    except Exception as e:
        logger.warning(f"[supermarktscanner:{slug}] Fetch failed: {e}")
        return []

    if not deals:
        logger.warning(f"[supermarktscanner:{slug}] Rendered {url} but found no deals — layout may have changed.")
    else:
        logger.info(f"[supermarktscanner:{slug}] {len(deals)} deals read from {url}")
    return deals
