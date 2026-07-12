"""
JSON exporter — replaces the old Google Sheets upload step.

Writes each store's deals to `data_dir/stores/<slug>.json` and keeps a
top-level `data_dir/index.json` manifest in sync so the static frontend can
discover which stores have data without listing the `stores/` directory.
"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from modules.models import DealItem

logger = logging.getLogger(__name__)


def slugify(name: str) -> str:
    """Match the lookup key used in main.py's _STORE_NAMES_LOWER: 'Albert Heijn' -> 'albert-heijn'."""
    return name.lower().replace(" ", "-")


def export_store(store_name: str, mode: str, deals: List[DealItem], data_dir: Path) -> None:
    """Write one store's deals to JSON and refresh the shared index.json manifest."""
    data_dir.mkdir(parents=True, exist_ok=True)
    stores_dir = data_dir / "stores"
    stores_dir.mkdir(parents=True, exist_ok=True)

    slug = slugify(store_name)
    now = datetime.now(timezone.utc).isoformat()

    store_payload = {
        "store": store_name,
        "slug": slug,
        "mode": mode,
        "updated_at": now,
        "deals": [deal.model_dump(exclude={"winkel"}) for deal in deals],
    }

    store_path = stores_dir / f"{slug}.json"
    with store_path.open("w", encoding="utf-8") as f:
        json.dump(store_payload, f, indent=2, ensure_ascii=False)

    _update_index(data_dir, slug, store_name, mode, len(deals), now)


def _update_index(
    data_dir: Path,
    slug: str,
    store_name: str,
    mode: str,
    deal_count: int,
    updated_at: str,
) -> None:
    index_path = data_dir / "index.json"

    if index_path.exists():
        try:
            with index_path.open("r", encoding="utf-8") as f:
                index = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"index.json unreadable ({e}) — starting a fresh manifest.")
            index = {}
    else:
        index = {}

    stores = index.get("stores")
    if not isinstance(stores, list):
        stores = []

    # Drop any existing entry for this slug, then re-insert — preserves other stores untouched.
    stores = [s for s in stores if s.get("slug") != slug]
    stores.append(
        {
            "slug": slug,
            "name": store_name,
            "mode": mode,
            "deal_count": deal_count,
            "updated_at": updated_at,
        }
    )

    index["generated_at"] = datetime.now(timezone.utc).isoformat()
    index["stores"] = stores

    with index_path.open("w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
