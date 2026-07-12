"""
Lidl DOM connector — structured data, no vision LLM needed.

Lidl's Schwarz-CDN leaflet API candidates are all dead (DNS failures/404s —
see git history). But https://www.lidl.nl/c/aanbiedingen/a10008785 (the
consumer offers page) renders completely normally for a real browser, with
each deal tile carrying a `data-gridbox-impression` attribute: a URL-encoded
JSON blob with the exact product name, price, and Lidl's own category
taxonomy (`wonCategoryPrimary`) — cleaner and more reliable than scraping
visible text, and it means we can categorize Lidl deals from Lidl's own
data instead of the LLM pass.

Lidl publishes offers in three weekly waves, each on its own tab (Maandag /
Woensdag / Vrijdag — confirmed very different sizes: ~12 / ~92 / ~104
tiles), so we click through all three instead of reading just the default tab.

About a third of the tiles are "group" deals (title starts with "Alle ",
e.g. "Alle burgers") covering several specific products at a price that
"varies from X to Y". Their detail page doesn't expose per-variant prices
(checked window.__NUXT__ data directly — its `variants`/`setItems` fields
are empty for these), but each variant's product image has descriptive alt
text (e.g. "800g runder hamburgers in een voordeelverpakking."), which we
use to create one entry per variant (price left null — genuinely not
available without simulating add-to-cart per variant, which we didn't
pursue) rather than one vague combined entry.
"""
import json
import logging
import re
from typing import List, Optional, Tuple
from urllib.parse import unquote, urljoin

from modules.models import DealItem

logger = logging.getLogger(__name__)

_BASE = "https://www.lidl.nl"
_URL = f"{_BASE}/c/aanbiedingen/a10008785"
_DAY_TABS = ["Maandag", "Woensdag", "Vrijdag"]
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_VOLUME_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(gram|gr|g|ml|liter|ltr|l|kg|stuks?|st\.?)\b", re.IGNORECASE)
_UNIT_MAP = {"gr": "gram", "g": "gram", "ltr": "liter", "l": "liter", "st": "stuks"}

# Lidl's own wonCategoryPrimary path segments -> our fixed category list.
# Matched by substring against the full "/"-joined path (case-insensitive).
_CATEGORY_KEYWORDS = [
    ("Diepvries", "Diepvries"),
    ("Vlees", "Vlees & Vis"),
    ("Vis", "Vlees & Vis"),
    ("Zuivel", "Zuivel & Eieren"),
    ("Eieren", "Zuivel & Eieren"),
    ("Brood", "Brood & Bakkerij"),
    ("Bakkerij", "Brood & Bakkerij"),
    ("Drank", "Dranken"),
    ("Snoep", "Snacks & Snoep"),
    ("Snack", "Snacks & Snoep"),
    ("Chocolade", "Snacks & Snoep"),
    ("Verzorging", "Verzorging & Drogisterij"),
    ("Drogist", "Verzorging & Drogisterij"),
    ("Huishoud", "Huishouden"),
    ("Groente", "Groente & Fruit"),
    ("Fruit", "Groente & Fruit"),
]


def _map_category(won_category_primary: str) -> Optional[str]:
    for keyword, category in _CATEGORY_KEYWORDS:
        if keyword.lower() in won_category_primary.lower():
            return category
    return None


def _parse_volume(text: str) -> Tuple[Optional[int], Optional[str]]:
    m = _VOLUME_RE.search(text)
    if not m:
        return None, None
    val = float(m.group(1).replace(",", "."))
    unit = m.group(2).lower().rstrip(".")
    unit = _UNIT_MAP.get(unit, unit)
    if unit == "liter" and val < 10:
        return int(val * 1000), "ml"
    if unit == "kg":
        return int(val * 1000), "gram"
    return int(val), unit


def _expand_group(page, href: str, category: Optional[str], price_range_text: Optional[str],
                   geldig_tekst: Optional[str]) -> List[DealItem]:
    """Visit a group deal's detail page and return one DealItem per variant image's alt text."""
    deals: List[DealItem] = []
    try:
        page.goto(urljoin(_BASE, href), wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)
        try:
            page.get_by_role("button", name="Akkoord").click(timeout=3000)
            page.wait_for_timeout(1000)
        except Exception:
            pass

        seen_alts = set()
        for img in page.locator("img[alt]").all():
            alt = (img.get_attribute("alt") or "").strip()
            if not alt or alt in seen_alts or "lidl logo" in alt.lower():
                continue
            seen_alts.add(alt)
            volume, unit = _parse_volume(alt)
            deals.append(DealItem(
                winkel="Lidl",
                productnaam=alt,
                korting_tekst=price_range_text,
                actieprijs=None,
                inhoud_waarde=volume,
                inhoud_unit=unit,
                geldig_tekst=geldig_tekst,
                categorie=category,
            ))
    except Exception as e:
        logger.debug(f"[Lidl] Failed to expand group at {href}: {e}")
    return deals


def fetch_lidl_deals() -> List[DealItem]:
    """
    Fetch Lidl's current offers across all three weekly-wave tabs by
    rendering the page with a headless browser and reading each tile's
    `data-gridbox-impression` JSON plus its visible size/availability text.
    "Alle X" group deals are expanded via their detail page.
    Returns an empty list (never raises) if Playwright/the page is unavailable.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.warning("[Lidl] Playwright not installed — run `pip install playwright` "
                        "and `playwright install chromium` to enable this connector.")
        return []

    deals: List[DealItem] = []
    seen_ids = set()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page(user_agent=_USER_AGENT, viewport={"width": 1400, "height": 900})
                page.goto(_URL, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(3000)
                try:
                    page.get_by_role("button", name="Akkoord").click(timeout=5000)
                except Exception:
                    pass
                page.wait_for_timeout(1500)

                for tab_label in _DAY_TABS:
                    try:
                        tab = page.get_by_text(tab_label, exact=True).first
                        tab.click(timeout=5000)
                        page.wait_for_timeout(2500)
                    except Exception as e:
                        logger.debug(f"[Lidl] Could not click tab '{tab_label}': {e}")
                        continue

                    tiles = page.locator("[data-gridbox-impression]").all()
                    # Collect what we need before navigating away for any group expansions.
                    tile_infos = []
                    for tile in tiles:
                        try:
                            raw = tile.get_attribute("data-gridbox-impression")
                            info = json.loads(unquote(raw)) if raw else {}
                            product_id = info.get("id")
                            if product_id and product_id in seen_ids:
                                continue

                            name = info.get("name")
                            if not name:
                                continue

                            href = None
                            link = tile.locator("a.odsc-tile__link")
                            if link.count():
                                href = link.first.get_attribute("href")

                            text = tile.inner_text()
                            avail_match = re.search(r"(Alleen in de winkel )?vanaf \d{2}/\d{2}(\s*-\s*\d{2}/\d{2})?", text)
                            geldig_tekst = avail_match.group(0) if avail_match else None

                            category = _map_category(info.get("wonCategoryPrimary") or "")

                            tile_infos.append((product_id, name, info.get("price"), href, text, geldig_tekst, category))
                            if product_id:
                                seen_ids.add(product_id)
                        except Exception as e:
                            logger.debug(f"[Lidl] Tile parse error: {e}")

                    for product_id, name, price, href, text, geldig_tekst, category in tile_infos:
                        if name.startswith("Alle ") and href:
                            price_range_match = re.search(r"Actieprijzen vari\S+ren van[^.\n]*\.?", text)
                            price_range_text = price_range_match.group(0) if price_range_match else None
                            expanded = _expand_group(page, href, category, price_range_text, geldig_tekst)
                            if expanded:
                                deals.extend(expanded)
                                # Re-select the day tab since we navigated away to expand this group.
                                try:
                                    page.goto(_URL, wait_until="domcontentloaded", timeout=30000)
                                    page.wait_for_timeout(1500)
                                    page.get_by_text(tab_label, exact=True).first.click(timeout=5000)
                                    page.wait_for_timeout(2000)
                                except Exception as e:
                                    logger.debug(f"[Lidl] Could not return to tab '{tab_label}': {e}")
                                continue

                        volume, unit = _parse_volume(text)
                        deals.append(DealItem(
                            winkel="Lidl",
                            productnaam=name,
                            korting_tekst=None,
                            actieprijs=float(price) if price is not None else None,
                            inhoud_waarde=volume,
                            inhoud_unit=unit,
                            geldig_tekst=geldig_tekst,
                            categorie=category,
                        ))
            finally:
                browser.close()
    except Exception as e:
        logger.warning(f"[Lidl] Playwright render failed: {e}")
        return []

    if not deals:
        logger.warning("[Lidl] Rendered the page but found no deal tiles — Lidl may have changed its layout.")
    else:
        logger.info(f"[Lidl] {len(deals)} deals read from the rendered page across {len(_DAY_TABS)} day tabs")
    return deals
