"""
Recipe ingredient -> current grocery deal matching.

Two independent pieces:
  1. parse_recipe_ingredients() — read `_recipes/*.md`, pull each recipe's
     slug and its BASE `## Ingredients` list (not the language-suffixed
     `## Ingredients (nl)` etc. sections — those are translations of the same
     list, re-parsing them would just duplicate work).
  2. match_ingredients_to_deals() — for each raw ingredient line, ask a local
     LLM which of the *currently scraped* deals (across all stores) are an
     actual match, e.g. "aubergine" should match "AH Aubergine 500g" but not
     "AH Augurken".

Talking to ~3000 deals per ingredient would be far too slow/expensive for a
local model, so every ingredient is pre-filtered down to a short candidate
list via a cheap keyword/substring heuristic first (see _extract_keyword) —
the LLM only ever sees a shortlist, and only has to return which *indices*
of that shortlist are real matches (not full product objects), keeping both
the prompt and the response small and easy to parse reliably.

Reuses the same "talk to Ollama's native /api/chat with thinking disabled,
fall back to the OpenAI-compatible client otherwise" pattern established in
modules/categorizer.py (see that module's docstring for why — hybrid-
reasoning models like qwen3.5:9b otherwise burn their whole completion
budget "thinking" and return empty content). Duplicated locally rather than
imported from categorizer.py to keep that module's working, single-purpose
category-tagging code untouched.
"""
import json
import logging
import re
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urljoin

import requests
from openai import OpenAI

from config import settings

logger = logging.getLogger(__name__)

# ── Recipe markdown parsing ───────────────────────────────────────────────────

_FRONTMATTER_RE = re.compile(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$")
_KV_RE = re.compile(r"^([^:]+):\s*(.*)$")
_HEADING_RE = re.compile(r"^##\s+(.*)$")
_ITEM_RE = re.compile(r"^\s*(?:[-*]|\d+[.)])\s+(.*)$")


def _strip_quotes(s: str) -> str:
    if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
        return s[1:-1]
    return s


def slugify(text: str) -> str:
    """Same rule as src/lib/recipes.js's slugify(): lowercase, trim, collapse
    any run of non-alphanumerics into a single hyphen, strip leading/trailing
    hyphens."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def _extract_title(frontmatter_block: str) -> Optional[str]:
    for line in frontmatter_block.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        m = _KV_RE.match(line)
        if m and m.group(1).strip() == "title":
            return _strip_quotes(m.group(2).strip())
    return None


def _extract_base_ingredients(content: str) -> List[str]:
    """Only the un-suffixed '## Ingredients' section — '## Ingredients (nl)'
    etc. are a different heading text entirely (the '(nl)' is part of the
    raw heading here, unlike recipes.js which splits it out), so they're
    simply never equal to "ingredients" and are skipped automatically."""
    items: List[str] = []
    in_target_section = False
    for line in content.splitlines():
        heading = _HEADING_RE.match(line)
        if heading:
            in_target_section = heading.group(1).strip().lower() == "ingredients"
            continue
        if not in_target_section:
            continue
        item = _ITEM_RE.match(line)
        if item and item.group(1).strip():
            items.append(item.group(1).strip())
    return items


def parse_recipe_ingredients(recipes_dir: Path) -> Dict[str, List[str]]:
    """Walk `_recipes/*.md` and return {recipe_slug: [raw ingredient line, ...]}
    for every recipe that has a non-empty base Ingredients section. Never
    raises for a single bad file — it's just skipped with a warning."""
    result: Dict[str, List[str]] = {}
    if not recipes_dir.exists():
        logger.warning(f"[ingredient_matcher] Recipes dir not found: {recipes_dir}")
        return result

    for path in sorted(recipes_dir.glob("*.md")):
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as e:
            logger.warning(f"[ingredient_matcher] Could not read {path.name}: {e}")
            continue

        m = _FRONTMATTER_RE.match(raw)
        if not m:
            logger.debug(f"[ingredient_matcher] {path.name}: no frontmatter block found — skipping")
            continue
        frontmatter_block, content = m.group(1), m.group(2)

        title = _extract_title(frontmatter_block) or path.stem
        slug = slugify(title)
        ingredients = _extract_base_ingredients(content)

        if not ingredients:
            logger.debug(f"[ingredient_matcher] {path.name}: no '## Ingredients' items found — skipping")
            continue

        result[slug] = ingredients

    return result


# ── Keyword pre-filter ────────────────────────────────────────────────────────

_STOPWORDS = {
    "g", "gr", "gram", "grams", "kg", "ml", "l", "liter", "liters", "litre",
    "tbsp", "tsp", "el", "tl", "eetlepel", "theelepel", "cup", "cups",
    "clove", "cloves", "piece", "pieces", "pinch", "handful",
    "whole", "large", "small", "medium", "big", "gros", "petit",
    "or", "and", "of", "the", "a", "an", "to", "for", "with", "plus",
    "fresh", "dried", "frozen", "raw", "cooked", "ground", "grated",
    "chopped", "sliced", "minced", "diced", "crushed", "peeled", "cubed",
    "optional", "taste", "serving", "extra", "about", "into",
    "boneless", "skinless", "thick", "thin", "cut", "long", "short",
    "white", "black", "yellow", "red", "green", "neutral", "full-fat",
}


def extract_keyword(ingredient_line: str) -> Optional[str]:
    """Cheap heuristic: drop parentheticals and anything after the first
    comma (usually prep instructions, e.g. ", cut into 2.5 cm cubes"), then
    take the last remaining word that isn't a quantity/unit/prep stopword.
    This is intentionally simple — it only needs to build a short candidate
    list for the LLM, which does the actual matching judgement. Public so
    main.py can reuse it to pick a keyword for the supermarktscanner.nl
    fallback lookup when an ingredient gets weak/no matches from our own data."""
    text = re.sub(r"\([^)]*\)", " ", ingredient_line)
    first_clause = text.split(",")[0]
    words = re.findall(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]*", first_clause)
    candidates = [w for w in words if len(w) > 2 and w.lower() not in _STOPWORDS]
    return candidates[-1].lower() if candidates else None


_MAX_SHORTLIST = 40  # kept in line with categorizer's batching philosophy — cap the LLM's workload per call
_SHORTLIST_CHUNK = 20  # same batch size categorizer.py settled on for qwen3.5:9b reliability


def _shortlist_deals(keyword: str, all_deals: List[dict]) -> List[dict]:
    kw = keyword.lower()
    matches = [d for d in all_deals if kw in d.get("productnaam", "").lower()]
    return matches[:_MAX_SHORTLIST]


_TRANSLATE_SYSTEM_PROMPT = (
    "You translate a single grocery ingredient word into the single Dutch word a Dutch "
    "supermarket would use for it on a product label. Reply with ONLY that one Dutch word, "
    "lowercase, no punctuation, no explanation. If the word given is already Dutch, or is a "
    "brand/proper noun with no translation, reply with the same word unchanged."
)


def translate_keyword_to_dutch(keyword: str, client: Optional[OpenAI], model: str) -> Optional[str]:
    """
    Most of our own deals data is Dutch-labeled, but recipe ingredient text is
    often English (e.g. "ginger", "spring onion") — a literal substring search
    for the English word would find nothing even when the product exists
    under its Dutch name ("gember", "lente-ui"). One cheap LLM call per
    *distinct* keyword (cached by the caller) fixes most of that gap.
    Returns None on any failure — caller falls back to the original keyword.
    """
    raw = _call_ollama_native_raw(settings.llm_base_url, model, _TRANSLATE_SYSTEM_PROMPT, keyword, num_predict=20)
    if raw is None and client is not None:
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _TRANSLATE_SYSTEM_PROMPT},
                    {"role": "user", "content": keyword},
                ],
                max_tokens=20,
                temperature=0.0,
                timeout=settings.llm_timeout,
            )
            raw = response.choices[0].message.content or ""
        except Exception as e:
            logger.debug(f"[ingredient_matcher] Translation call failed for '{keyword}': {e}")
            return None
    if not raw:
        return None
    word = re.sub(r"[^a-zà-ÿ\-]", "", raw.strip().lower())
    return word or None


# ── LLM matching (Ollama-native, think:false, falling back to OpenAI-compatible) ──

_SYSTEM_PROMPT = (
    "You are a JSON-only matching assistant for Dutch supermarket products. "
    "You NEVER write explanatory text or markdown. You ONLY output a raw JSON array of integers. "
    "Match a candidate only if it IS the ingredient itself as a standalone product (packaging, "
    "brand, or size differences are fine). Reject two common false-positive patterns: "
    "(1) a different-but-similar-sounding product, e.g. ingredient 'aubergine' must not match "
    "candidate 'Augurken' (gherkins); "
    "(2) a product merely flavored with, seasoned with, or containing the ingredient as a minor "
    "component, e.g. ingredient 'garlic' must NOT match 'Garlic & Herbs fries', 'Garlic pickle "
    "relish', or 'Garlic sauce' — none of those ARE garlic, they just taste of it. When in doubt, "
    "reject rather than accept."
)


def _build_prompt(ingredient_line: str, names: List[str]) -> str:
    numbered = "\n".join(f"{i}. {name}" for i, name in enumerate(names))
    return f"""Ingredient needed for a recipe: "{ingredient_line}"

Candidate supermarket products (0-indexed):
{numbered}

Which candidates (if any) are actually the same food item as the ingredient above?
Return ONLY a raw JSON array of the matching indices, e.g. [0, 3]. Return [] if none match.
No markdown, no explanation."""


def _strip_markdown_fences(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text.strip(), flags=re.MULTILINE)
    return text.strip()


def _parse_indices(raw: str, shortlist_len: int) -> Optional[List[int]]:
    cleaned = _strip_markdown_fences(raw)
    start, end = cleaned.find("["), cleaned.rfind("]")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start: end + 1]

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        try:
            import json_repair
            data = json_repair.repair_json(cleaned, return_objects=True)
        except Exception as e:
            logger.debug(f"[ingredient_matcher] JSON repair failed: {e}")
            return None

    if not isinstance(data, list):
        return None

    indices = []
    for v in data:
        try:
            i = int(v)
        except (TypeError, ValueError):
            continue
        if 0 <= i < shortlist_len:
            indices.append(i)
    return indices


def _call_ollama_native_raw(base_url: str, model: str, system_prompt: str, user_content: str,
                             num_predict: int = 512) -> Optional[str]:
    """Try Ollama's native /api/chat with thinking disabled. Returns None on any failure."""
    native_root = re.sub(r"/v1/?$", "", base_url.rstrip("/"))
    try:
        resp = requests.post(
            urljoin(native_root + "/", "api/chat"),
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                "stream": False,
                "think": False,
                "options": {"temperature": 0.0, "num_predict": num_predict},
            },
            timeout=settings.llm_timeout,
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "")
    except Exception as e:
        logger.debug(f"[ingredient_matcher] Ollama native /api/chat unavailable ({e}), "
                      f"falling back to OpenAI-compatible client")
        return None


def _call_openai_compatible(client: OpenAI, model: str, ingredient_line: str, names: List[str]) -> Optional[str]:
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _build_prompt(ingredient_line, names)},
            ],
            max_tokens=512,
            temperature=0.0,
            timeout=settings.llm_timeout,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        logger.warning(f"[ingredient_matcher] LLM call failed for '{ingredient_line}' "
                        f"({len(names)} candidates): {e}")
        return None


def _select_batch(client: OpenAI, model: str, ingredient_line: str, names: List[str], _depth: int = 0) -> List[int]:
    """Returns matching indices *within `names`*. Retries a batch that fails
    to parse as two smaller halves (mirrors categorizer.py's approach) before
    giving up and returning no matches for that slice."""
    raw = _call_ollama_native_raw(settings.llm_base_url, model, _SYSTEM_PROMPT, _build_prompt(ingredient_line, names))
    if raw is None:
        raw = _call_openai_compatible(client, model, ingredient_line, names)

    indices = _parse_indices(raw, len(names)) if raw is not None else None
    if indices is not None:
        return indices

    if len(names) > 4 and _depth < 3:
        mid = len(names) // 2
        left = _select_batch(client, model, ingredient_line, names[:mid], _depth + 1)
        right = [i + mid for i in _select_batch(client, model, ingredient_line, names[mid:], _depth + 1)]
        return left + right

    logger.warning(f"[ingredient_matcher] Giving up on a candidate batch of {len(names)} "
                    f"for '{ingredient_line}' — no matches recorded for it")
    return []


def _deal_match_dict(deal: dict) -> dict:
    """Same fields as the source deal — no need to invent new ones. `winkel`
    is expected to already be present on `deal` (added when the caller loaded
    the store JSON files, since exporter.py deliberately omits it there —
    it's implied by which store's file the deal came from)."""
    return {
        "winkel": deal.get("winkel"),
        "productnaam": deal.get("productnaam"),
        "actieprijs": deal.get("actieprijs"),
        "inhoud_waarde": deal.get("inhoud_waarde"),
        "inhoud_unit": deal.get("inhoud_unit"),
        "korting_tekst": deal.get("korting_tekst"),
    }


def match_ingredients_to_deals(
    ingredient_lines: List[str],
    all_deals: List[dict],
    client: Optional[OpenAI] = None,
    model: Optional[str] = None,
) -> Dict[str, List[dict]]:
    """
    For each raw ingredient line, return the current deals (across all
    stores) that are a genuine match, cheapest-first (deals with no known
    price sort last). Ingredients whose keyword pre-filter finds nothing in
    `all_deals` never reach the LLM at all and simply get an empty list —
    they're exactly the ones worth trying modules/supermarktscanner_connector.py
    on as a fallback.
    """
    if client is None:
        client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)
    model = model or settings.llm_model

    # Most of our deals data is Dutch-labeled but recipe ingredients are often
    # English — translate each *distinct* keyword once (cached here) and try
    # both the original and translated word when shortlisting, since a
    # loanword (e.g. "avocado") needs no translation but "ginger"/"gember" do.
    translation_cache: Dict[str, Optional[str]] = {}

    results: Dict[str, List[dict]] = {}
    for line in ingredient_lines:
        keyword = extract_keyword(line)
        if not keyword:
            results[line] = []
            continue

        if keyword not in translation_cache:
            translation_cache[keyword] = translate_keyword_to_dutch(keyword, client, model)
        translated = translation_cache[keyword]

        shortlist = _shortlist_deals(keyword, all_deals)
        if translated and translated != keyword:
            seen_ids = {id(d) for d in shortlist}
            shortlist += [d for d in _shortlist_deals(translated, all_deals) if id(d) not in seen_ids]
            shortlist = shortlist[:_MAX_SHORTLIST]

        if not shortlist:
            results[line] = []
            continue

        names = [d.get("productnaam", "") for d in shortlist]
        matched_indices: List[int] = []
        for start in range(0, len(names), _SHORTLIST_CHUNK):
            chunk = names[start: start + _SHORTLIST_CHUNK]
            chunk_indices = _select_batch(client, model, line, chunk)
            matched_indices.extend(i + start for i in chunk_indices)

        matches = [_deal_match_dict(shortlist[i]) for i in sorted(set(matched_indices))]
        matches.sort(key=lambda m: (m["actieprijs"] is None, m["actieprijs"]))
        results[line] = matches

        nl_suffix = f", nl='{translated}'" if translated and translated != keyword else ""
        logger.info(f"[ingredient_matcher] '{line}' (keyword='{keyword}'{nl_suffix}): "
                    f"{len(matches)}/{len(shortlist)} shortlisted candidates matched")

    return results
