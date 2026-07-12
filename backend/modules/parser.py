import json
import logging
import re
from typing import List

import json_repair

from modules.models import DealItem

logger = logging.getLogger(__name__)


def _strip_markdown_fences(text: str) -> str:
    """Remove ```json ... ``` or ``` ... ``` wrappers that local LLMs often add."""
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text.strip(), flags=re.MULTILINE)
    return text.strip()


def _extract_array_bounds(text: str) -> str:
    """Return the substring from first '[' to last ']', or original text."""
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]
    return text


def parse_llm_response(raw: str, store_name: str, page_num: int) -> List[DealItem]:
    """Parse and validate LLM output into DealItem objects. Never raises."""
    if not raw or not raw.strip():
        logger.warning(f"[{store_name}] Page {page_num}: Empty LLM response")
        return []

    # Step 1: strip markdown fences
    cleaned = _strip_markdown_fences(raw)

    # Step 2: isolate the JSON array
    cleaned = _extract_array_bounds(cleaned)

    # Step 3: try direct parse, fall back to json-repair
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.debug(f"[{store_name}] Page {page_num}: JSON malformed, attempting repair")
        try:
            data = json_repair.repair_json(cleaned, return_objects=True)
        except Exception as e:
            logger.error(f"[{store_name}] Page {page_num}: JSON repair failed — {e}")
            logger.debug(f"Problematic response:\n{raw[:600]}")
            return []

    # Step 4: normalize container type
    if not isinstance(data, list):
        if isinstance(data, dict):
            for key in ("deals", "items", "products", "aanbiedingen", "data"):
                if key in data and isinstance(data[key], list):
                    data = data[key]
                    break
            else:
                data = [data]
        else:
            logger.warning(f"[{store_name}] Page {page_num}: Unexpected response type: {type(data)}")
            return []

    # Step 5: validate each item with Pydantic
    valid_items: List[DealItem] = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        if not item.get("winkel"):
            item["winkel"] = store_name
        try:
            valid_items.append(DealItem(**item))
        except Exception as e:
            logger.debug(f"[{store_name}] Page {page_num}: Item {i} invalid ({e}) → {item}")

    logger.info(
        f"[{store_name}] Page {page_num}: {len(valid_items)} valid deals "
        f"({len(data) - len(valid_items)} dropped)"
    )
    return valid_items
