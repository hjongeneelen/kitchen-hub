"""
Jumbo DOM connector — structured data, no vision LLM needed.

Jumbo's mobile/GraphQL APIs are behind Akamai Bot Manager (confirmed: plain
`requests` calls get a bot-mitigation challenge page even against the site's
own GraphQL endpoint). But the public *website* itself renders fine for a
real browser — Akamai's block triggers on the API traffic pattern, not on
loading the page. So instead of calling an API, we drive a real (headless)
Chromium via Playwright and read deal cards straight out of the DOM — no
OCR/vision needed, since the text is plain HTML, just not reachable via a
bare HTTP request.

We read /aanbiedingen/nu, which lazy-loads far more than its initial ~24
cards: it only reveals more as you scroll deep enough (confirmed: nothing
new appears until repeated `window.scrollTo(bottom)` calls past the ~5th
round, then it jumps to 100+). A shallow scroll — a handful of mouse-wheel
ticks — looks fully loaded but isn't; we scroll until the page height is
stable across several consecutive rounds before stopping.

We deliberately did NOT go with /producten/alle-aanbiedingen/ (a separate,
richer "all offers" catalog with ~1300 items) — its pagination doesn't
respond to a headless browser at all (see git history / README), so it
would've meant settling for its ~24-item first page.

About a third of the cards are "group" deals (title starts with "Alle ",
e.g. "Alle Jumbo groene salades") covering several specific products under
one promo. Their detail page (linked from the card) lists each individual
product with its own name/price/size, so we visit it and expand the group
into one DealItem per product instead of a single vague entry.
"""
import logging
import re
from typing import List, Optional, Tuple
from urllib.parse import urljoin

from modules.models import DealItem

logger = logging.getLogger(__name__)

_BASE = "https://www.jumbo.com"
_URL = f"{_BASE}/aanbiedingen/nu"
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_MAX_SCROLL_ROUNDS = 60
_STABLE_ROUNDS_TO_STOP = 5

_VOLUME_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(gram|gr|g|ml|liter|ltr|l|kg)\b", re.IGNORECASE)
_UNIT_MAP = {"gr": "gram", "g": "gram", "ltr": "liter", "l": "liter"}


def _parse_price(tag_text: str) -> Optional[float]:
    """Pull a euro price out of tags like 'voor 2,49' or '2 voor 4,00'."""
    numbers = re.findall(r"(\d+,\d{2})", tag_text)
    if not numbers:
        return None
    return float(numbers[-1].replace(",", "."))


def _parse_volume_from_title(title: str) -> Tuple[Optional[int], Optional[str]]:
    m = _VOLUME_RE.search(title)
    if not m:
        return None, None
    val = float(m.group(1).replace(",", "."))
    unit = _UNIT_MAP.get(m.group(2).lower(), m.group(2).lower())
    if unit == "liter":
        val *= 1000
        unit = "ml"
    if unit == "kg":
        val *= 1000
        unit = "gram"
    return int(round(val)), unit


def _expand_group(page, href: str, korting_tekst: Optional[str], geldig_tekst: Optional[str]) -> List[DealItem]:
    """Visit a group deal's detail page and return one DealItem per listed product."""
    deals: List[DealItem] = []
    try:
        page.goto(urljoin(_BASE, href), wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(1500)
        for card in page.locator('[data-testid="product-card"]').all():
            try:
                title = card.locator("h3").first.inner_text().strip()
                if not title:
                    continue
                price_match = re.search(r"Prijs:.*?(\d+,\d{2})", card.inner_text())
                price = float(price_match.group(1).replace(",", ".")) if price_match else None
                volume, unit = _parse_volume_from_title(title)
                deals.append(DealItem(
                    winkel="Jumbo",
                    productnaam=title,
                    korting_tekst=korting_tekst,
                    actieprijs=price,
                    inhoud_waarde=volume,
                    inhoud_unit=unit,
                    geldig_tekst=geldig_tekst,
                ))
            except Exception as e:
                logger.debug(f"[Jumbo] Group variant parse error: {e}")
    except Exception as e:
        logger.debug(f"[Jumbo] Failed to expand group at {href}: {e}")
    return deals


def fetch_jumbo_deals() -> List[DealItem]:
    """
    Fetch Jumbo's current offers by rendering /aanbiedingen/nu with a
    headless browser, scrolling until no more cards lazy-load, and reading
    each card's DOM text directly. "Alle X" group deals are expanded into
    their individual listed products via their detail page.
    Returns an empty list (never raises) if Playwright/the page is unavailable.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.warning("[Jumbo] Playwright not installed — run `pip install playwright` "
                        "and `playwright install chromium` to enable this connector.")
        return []

    deals: List[DealItem] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page(user_agent=_USER_AGENT, viewport={"width": 1400, "height": 900})
                page.goto(_URL, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(3000)

                prev_height = -1
                stable_rounds = 0
                for _ in range(_MAX_SCROLL_ROUNDS):
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    page.wait_for_timeout(900)
                    height = page.evaluate("document.body.scrollHeight")
                    stable_rounds = stable_rounds + 1 if height == prev_height else 0
                    prev_height = height
                    if stable_rounds >= _STABLE_ROUNDS_TO_STOP:
                        break

                cards = page.locator('[data-testid="promotion-card"]').all()
                seen_ids = set()
                # Collect what we need per card up front — we're about to navigate
                # away to expand groups, which would invalidate these locators.
                card_infos = []
                for card in cards:
                    try:
                        card_id = card.get_attribute("id")
                        if card_id and card_id in seen_ids:
                            continue
                        title = card.locator("h3").first.inner_text().strip()
                        if not title:
                            continue
                        tag_text = ""
                        tag_loc = card.locator(".tag")
                        if tag_loc.count():
                            tag_text = tag_loc.first.inner_text().strip()
                        subtitle_loc = card.locator(".subtitle")
                        subtitle = subtitle_loc.first.inner_text().strip() if subtitle_loc.count() else None
                        href = None
                        link_loc = card.locator("a")
                        if link_loc.count():
                            href = link_loc.first.get_attribute("href")
                        card_infos.append((title, tag_text, subtitle, href))
                        if card_id:
                            seen_ids.add(card_id)
                    except Exception as e:
                        logger.debug(f"[Jumbo] Card parse error: {e}")

                for title, tag_text, subtitle, href in card_infos:
                    if title.startswith("Alle ") and href:
                        expanded = _expand_group(page, href, tag_text or None, subtitle or None)
                        if expanded:
                            deals.extend(expanded)
                            continue
                        # fall through to a single group entry if expansion failed/found nothing

                    deals.append(DealItem(
                        winkel="Jumbo",
                        productnaam=title,
                        korting_tekst=tag_text or None,
                        actieprijs=_parse_price(tag_text),
                        inhoud_waarde=None,
                        inhoud_unit=None,
                        geldig_tekst=subtitle or None,
                    ))
            finally:
                browser.close()
    except Exception as e:
        logger.warning(f"[Jumbo] Playwright render failed: {e}")
        return []

    if not deals:
        logger.warning("[Jumbo] Rendered the page but found no deal cards — Jumbo may have changed its layout.")
    else:
        logger.info(f"[Jumbo] {len(deals)} deals read from the rendered page (incl. expanded group deals)")
    return deals
