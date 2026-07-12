import logging
from abc import ABC
from typing import Optional

import requests

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "nl-NL,nl;q=0.9",
}


class BaseScraper(ABC):
    store_name: str = ""

    def discover_pdf_url(self) -> Optional[str]:
        """
        Attempt to find the current week's PDF URL.
        Override in subclasses. Returns None if not applicable or on failure.
        """
        return None

    def _get(self, url: str, **kwargs) -> Optional[requests.Response]:
        try:
            resp = requests.get(url, headers=_HEADERS, timeout=30, **kwargs)
            resp.raise_for_status()
            return resp
        except Exception as e:
            logger.debug(f"[{self.store_name}] GET {url} → {e}")
            return None

    def _is_pdf(self, resp: requests.Response) -> bool:
        return resp.content[:4] == b"%PDF"
