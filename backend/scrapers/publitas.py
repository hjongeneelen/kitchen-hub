"""
Generic Publitas scraper — works for any store hosted on Publitas.

Discovery strategy:
  1. GET the group root URL.  Publitas issues a server-side redirect to the
     latest live publication, e.g.
       view.publitas.com/boni-supermarkt  →  view.publitas.com/boni-supermarkt/boni-folder-week-26-2026
  2. Append /unsupported to get the direct PDF download.
  3. If no redirect happened (JS-rendered entry page), fall back to parsing
     the page HTML for an embedded publication slug.

Works for:
  - Slug-based groups:   PublitasScraper("Boni", "boni-supermarkt")
  - Numeric group IDs:   PublitasScraper("Kruidvat", "189")
  - Custom domains:      PublitasScraper("Etos", "etos", base_url="https://folder.etos.nl")
"""
import logging
import re
from typing import Optional

from scrapers.base import BaseScraper

logger = logging.getLogger(__name__)


class PublitasScraper(BaseScraper):

    _VIEWER = "https://view.publitas.com"

    def __init__(self, store_name: str, group: str, base_url: Optional[str] = None):
        """
        Args:
            store_name: Human-readable label for logging.
            group:      Publitas group slug (e.g. "boni-supermarkt") or numeric ID.
            base_url:   Full base URL for custom-domain stores, e.g.
                        "https://folder.etos.nl". Overrides the default
                        view.publitas.com/{group} root.
        """
        self.store_name = store_name
        self.group = str(group)
        self._root = (base_url or f"{self._VIEWER}/{group}").rstrip("/")

    def discover_pdf_url(self) -> Optional[str]:
        logger.info(f"[{self.store_name}] Querying Publitas root: {self._root}")

        resp = self._get(self._root, allow_redirects=True)
        if not resp:
            logger.warning(f"[{self.store_name}] Publitas root unreachable.")
            return None

        final_url = resp.url.rstrip("/")

        # ── Path 1: server-side redirect landed us on a publication ──────────
        if final_url != self._root:
            pdf_url = f"{final_url}/unsupported"
            result = self._verify_pdf_url(pdf_url)
            if result:
                logger.info(f"[{self.store_name}] PDF via redirect: {pdf_url}")
                return result

        # ── Path 2: parse HTML for embedded publication slug ─────────────────
        slug = self._extract_slug(resp.text)
        if slug:
            pdf_url = f"{self._root}/{slug}/unsupported"
            result = self._verify_pdf_url(pdf_url)
            if result:
                logger.info(f"[{self.store_name}] PDF via HTML slug '{slug}': {pdf_url}")
                return result

        logger.warning(
            f"[{self.store_name}] Publitas auto-discovery failed. "
            f"Set the override URL in .env to skip scraping."
        )
        return None

    # ── Private helpers ───────────────────────────────────────────────────────

    def _verify_pdf_url(self, url: str) -> Optional[str]:
        """
        GET the /unsupported URL and confirm the response is a PDF.
        Publitas may redirect /unsupported to a CDN URL — follow redirects.
        Returns the final URL (after redirects) on success, else None.
        """
        resp = self._get(url, allow_redirects=True)
        if not resp:
            return None
        # Check magic bytes
        if resp.content[:4] == b"%PDF":
            return resp.url  # return the final CDN URL in case of redirect
        # Some stores return 200 HTML instead of PDF — treat as failure
        return None

    def _extract_slug(self, html: str) -> Optional[str]:
        """Parse Publitas viewer HTML for the current publication slug."""
        patterns = [
            # JSON config embedded in <script> blocks: "slug":"boni-folder-week-26-2026"
            r'"slug"\s*:\s*"([a-z0-9][a-z0-9\-]{4,80})"',
            # URL pattern after the group identifier in any attribute/script
            rf'/{re.escape(self.group)}/([a-z0-9][a-z0-9\-]{{4,80}})(?:[/"\'\\s]|$)',
        ]
        skip = {"unsupported", "undefined", "null", "latest", "current", "index"}

        for pattern in patterns:
            for match in re.findall(pattern, html, re.IGNORECASE):
                candidate = match.strip("/")
                if candidate.lower() not in skip and len(candidate) > 6:
                    return candidate
        return None
