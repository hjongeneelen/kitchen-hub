"""
Category tagging via a local text LLM (Ollama) — a separate, optional pass
over already-extracted deals, not part of any single store's fetch step.

Runs product names through the same local LLM used for vision extraction
(no vision needed here, just plain chat), in batches, asking it to pick one
of a fixed category list per product. Batching keeps the number of LLM calls
proportional to dataset size / batch size rather than one call per item —
with ~2000 deals across all stores, one-call-per-item would be far too slow
for a local model to be practical.

Hybrid-reasoning models (e.g. Qwen3) burn their entire token budget on
internal "thinking" before ever emitting the actual answer unless thinking
is explicitly disabled — confirmed with qwen3.5:9b via Ollama: with
thinking on, a 3-item batch used all 2048 completion tokens on reasoning
and produced an empty final answer (~57s); with Ollama's native `think:
false` option, the same batch returns instantly (<1s) with a clean answer.
That option only exists on Ollama's native /api/chat endpoint, not the
OpenAI-compatible /v1 one, so this module talks to Ollama directly and
falls back to the OpenAI-compatible client (no `think` toggle) for any
other backend.
"""
import json
import logging
import re
from typing import List, Optional
from urllib.parse import urljoin

import requests
from openai import OpenAI

from config import settings
from modules.models import DealItem

logger = logging.getLogger(__name__)

CATEGORIES = [
    "Groente & Fruit",
    "Vlees & Vis",
    "Zuivel & Eieren",
    "Brood & Bakkerij",
    "Diepvries",
    "Dranken",
    "Snacks & Snoep",
    "Kruidenierswaren",  # pasta, rijst, conserven, sauzen, olie, ontbijt e.d.
    "Verzorging & Drogisterij",
    "Huishouden",
    "Overig",
]

_BATCH_SIZE = 20  # 40 was unreliable — qwen3.5:9b would occasionally miscount and return fewer categories than products

_SYSTEM_PROMPT = (
    "You are a JSON-only classification assistant for Dutch supermarket products. "
    "You NEVER write explanatory text or markdown. You ONLY output a raw JSON array of strings. "
    "Classify by the product itself, not by any sauce/side/condiment it's served with — e.g. "
    "'Bapao kipsate' and 'Bapao rundvlees' are both meat snacks (Vlees & Vis), not Zuivel & Eieren, "
    "even though 'sate' can also refer to a peanut sauce elsewhere. Meat-substitute/vegetarian "
    "products (tofu, vega burgers, 'De Vegetarische Slager', etc.) also belong under Vlees & Vis."
)

_CATEGORY_LIST_TEXT = "\n".join(f"- {c}" for c in CATEGORIES)


def _build_prompt(names: List[str]) -> str:
    numbered = "\n".join(f"{i + 1}. {name}" for i, name in enumerate(names))
    return f"""Classify each Dutch supermarket product below into exactly one of these categories:
{_CATEGORY_LIST_TEXT}

Products:
{numbered}

Return ONLY a raw JSON array of {len(names)} strings (one category per product, in the same
order), each value copied exactly from the category list above. No markdown, no explanation."""


def _strip_markdown_fences(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text.strip(), flags=re.MULTILINE)
    return text.strip()


def _parse_categories(raw: str, expected_count: int) -> Optional[List[str]]:
    cleaned = _strip_markdown_fences(raw)
    start, end = cleaned.find("["), cleaned.rfind("]")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start : end + 1]

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        try:
            import json_repair
            data = json_repair.repair_json(cleaned, return_objects=True)
        except Exception as e:
            logger.debug(f"[categorizer] JSON repair failed: {e}")
            return None

    if not isinstance(data, list) or len(data) != expected_count:
        return None

    valid_set = set(CATEGORIES)
    return [c if isinstance(c, str) and c in valid_set else None for c in data]


def _call_ollama_native(base_url: str, model: str, names: List[str]) -> Optional[str]:
    """Try Ollama's native /api/chat with thinking disabled. Returns None on any failure."""
    native_root = re.sub(r"/v1/?$", "", base_url.rstrip("/"))
    try:
        resp = requests.post(
            urljoin(native_root + "/", "api/chat"),
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": _build_prompt(names)},
                ],
                "stream": False,
                "think": False,
                "options": {"temperature": 0.0, "num_predict": 2048},
            },
            timeout=settings.llm_timeout,
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "")
    except Exception as e:
        logger.debug(f"[categorizer] Ollama native /api/chat unavailable ({e}), falling back to OpenAI-compatible client")
        return None


def _call_openai_compatible(client: OpenAI, model: str, names: List[str]) -> Optional[str]:
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _build_prompt(names)},
            ],
            max_tokens=2048,
            temperature=0.0,
            timeout=settings.llm_timeout,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        logger.warning(f"[categorizer] LLM call failed for a batch of {len(names)}: {e}")
        return None


def _categorize_batch(client: OpenAI, model: str, names: List[str], _depth: int = 0) -> List[Optional[str]]:
    raw = _call_ollama_native(settings.llm_base_url, model, names)
    if raw is None:
        raw = _call_openai_compatible(client, model, names)

    categories = _parse_categories(raw, len(names)) if raw is not None else None
    if categories is not None:
        return categories

    # The model sometimes miscounts and returns the wrong number of entries.
    # Retry as two smaller halves (a couple of levels deep) before giving up —
    # smaller batches are markedly more reliable than large ones.
    if len(names) > 4 and _depth < 3:
        mid = len(names) // 2
        logger.debug(f"[categorizer] Batch of {len(names)} failed to parse — retrying as two halves")
        return (
            _categorize_batch(client, model, names[:mid], _depth + 1)
            + _categorize_batch(client, model, names[mid:], _depth + 1)
        )

    logger.warning(f"[categorizer] Giving up on a batch of {len(names)} — leaving uncategorized")
    return [None] * len(names)


def categorize_deals(deals: List[DealItem], client: Optional[OpenAI] = None, model: Optional[str] = None) -> int:
    """
    Assign `.categorie` on each DealItem in place, via the local LLM, in
    batches of _BATCH_SIZE. Deals that already have a categorie left over
    from a previous run are left untouched and don't cost an LLM call.
    Returns the number of deals newly tagged. Never raises — deals that fail
    to categorize are just left as None.
    """
    todo = [d for d in deals if not d.categorie]
    if not todo:
        return 0
    if client is None:
        client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)
    model = model or settings.llm_model

    tagged = 0
    total_batches = -(-len(todo) // _BATCH_SIZE)
    for i in range(0, len(todo), _BATCH_SIZE):
        batch = todo[i : i + _BATCH_SIZE]
        names = [d.productnaam for d in batch]
        categories = _categorize_batch(client, model, names)
        for deal, category in zip(batch, categories):
            if category:
                deal.categorie = category
                tagged += 1
        logger.info(f"[categorizer] Batch {i // _BATCH_SIZE + 1}/{total_batches}: "
                    f"{sum(1 for c in categories if c)}/{len(batch)} tagged")

    return tagged
