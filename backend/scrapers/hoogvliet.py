"""
Hoogvliet scraper — Tier A (fully automatable).

Hoogvliet hosts their folder at folder.hoogvliet.com using a Publitas
custom domain with the most predictable URL pattern of any Dutch retailer:

    https://folder.hoogvliet.com/folder_{YEAR}_{WEEK:02d}/unsupported

This is constructed directly from the current ISO week number without any
scraping. If the current week's folder isn't published yet (e.g. Monday
morning before it goes live), we fall back to the previous week.
"""
import logging
from datetime import date, timedelta
from typing import Optional

from scrapers.base import BaseScraper

logger = logging.getLogger(__name__)

_BASE = "https://folder.hoogvliet.com"


class HoogvlietScraper(BaseScraper):
    store_name = "Hoogvliet"

    def discover_pdf_url(self) -> Optional[str]:
        for delta in (0, -7, 7):
            target = date.today() + timedelta(days=delta)
            iso = target.isocalendar()
            url = f"{_BASE}/folder_{iso[0]}_{iso[1]:02d}/unsupported"
            logger.debug(f"[Hoogvliet] Trying: {url}")
            resp = self._get(url, allow_redirects=True)
            if resp and self._is_pdf(resp):
                logger.info(f"[Hoogvliet] Found PDF (week {iso[1]}, {iso[0]}): {resp.url}")
                return resp.url
        logger.warning(
            "[Hoogvliet] Week-number URL construction failed for ±1 week. "
            "Set HOOGVLIET_PDF_URL in .env as override."
        )
        return None
