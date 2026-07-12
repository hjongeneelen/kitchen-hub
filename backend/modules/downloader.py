import hashlib
import logging
from pathlib import Path
from typing import Optional

import requests

from config import settings

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "image/jpeg,image/*,application/pdf,*/*",
}


def _cache_path(url: str) -> Path:
    url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    return settings.cache_dir / f"{url_hash}.pdf"


def download_pdf(url: str, store_name: str) -> Optional[Path]:
    """Download a PDF with file-level caching. Returns local path or None on failure."""
    path = _cache_path(url)

    if path.exists():
        logger.info(f"[{store_name}] Cache hit → {path}")
        return path

    logger.info(f"[{store_name}] Downloading {url}")
    try:
        chunks: list[bytes] = []
        magic_checked = False

        with requests.get(url, headers=_HEADERS, timeout=60, stream=True) as resp:
            resp.raise_for_status()

            for chunk in resp.iter_content(chunk_size=8192):
                if not chunk:
                    continue
                if not magic_checked:
                    if not chunk[:4] == b"%PDF":
                        logger.error(
                            f"[{store_name}] Response is not a PDF "
                            f"(got: {chunk[:20]!r}). Check the URL."
                        )
                        return None
                    magic_checked = True
                chunks.append(chunk)

        path.write_bytes(b"".join(chunks))
        logger.info(f"[{store_name}] Saved → {path} ({path.stat().st_size / 1024:.0f} KB)")
        return path

    except requests.HTTPError as e:
        logger.error(f"[{store_name}] HTTP {e.response.status_code} for {url}")
    except requests.RequestException as e:
        logger.error(f"[{store_name}] Download error: {e}")

    return None
