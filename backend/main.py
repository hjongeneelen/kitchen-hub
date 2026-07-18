"""
Dutch Supermarket Deal Scraper
──────────────────────────────
Scrapes supermarktscanner.nl's curated "beste supermarkt aanbiedingen" page
(modules/supermarktscanner_connector.py) — a cross-store best-deals listing —
and exports the result as JSON per store for the static dashboard site
(public/data/). supermarktscanner.nl is the app's only deals source; there is
no per-store scraping and no PDF/vision-LLM pipeline anymore.

Usage:
  python main.py                                    # scrape + export
  python main.py --categorize                       # also tag each deal with a category via the local LLM
  python main.py --no-export                        # scrape only, skip JSON export
  python main.py --match-ingredients                # match _recipes/*.md ingredients to current deals (reads
                                                      # public/data/stores/*.json from disk — no scrape needed;
                                                      # standalone unless combined with a plain run first)
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set

from openai import OpenAI

from config import settings
from modules.categorizer import categorize_deals
from modules.exporter import export_store
from modules.ingredient_matcher import extract_keyword, match_ingredients_to_deals, parse_recipe_ingredients, translate_keyword_to_dutch
from modules.llm_connector import get_llm_client
from modules.models import DealItem
from modules.supermarktscanner_connector import fetch_deals_overview, fetch_ingredient_prices

# ── Logging ───────────────────────────────────────────────────────────────────
Path("logs").mkdir(exist_ok=True)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252, which can't encode the box-drawing chars below
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("logs/pipeline.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

_MODE = "scan"  # every store's deals now come from the same supermarktscanner.nl scan


def _group_by_store(deals: List[DealItem]) -> Dict[str, List[DealItem]]:
    grouped: Dict[str, List[DealItem]] = {}
    for deal in deals:
        grouped.setdefault(deal.winkel, []).append(deal)
    return grouped


# ── Ingredient matching (--match-ingredients) ─────────────────────────────────
# A separate, optional pass — like --categorize — but one that reads its input
# straight from disk (all stores' exported JSON, not just whatever was scraped
# in this particular run) so it can be run entirely standalone, e.g. right
# after a manual data refresh, without re-scraping anything.

_RECIPES_DIR = Path("../_recipes")
_WEAK_MATCH_THRESHOLD = 2  # fewer than this many own-data matches -> also try the supermarktscanner.nl fallback


def _load_all_deals(data_dir: Path) -> List[dict]:
    """Load every store's exported deals into one flat list of plain dicts.
    exporter.py deliberately omits "winkel" from each per-store deal (it's
    implied by which store's file it came from) — re-add it here now that
    deals from every store are being combined into one list."""
    stores_dir = data_dir / "stores"
    all_deals: List[dict] = []
    if not stores_dir.exists():
        return all_deals

    for path in sorted(stores_dir.glob("*.json")):
        try:
            with path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"[match-ingredients] Could not read {path.name}: {e}")
            continue

        store_name = payload.get("store", path.stem)
        for deal in payload.get("deals", []):
            deal = dict(deal)
            deal.setdefault("winkel", store_name)
            all_deals.append(deal)

    return all_deals


def _run_match_ingredients(client: Optional[OpenAI]) -> None:
    logger.info("\n── Ingredient matching " + "─" * 41)

    all_deals = _load_all_deals(settings.data_dir)
    if not all_deals:
        logger.warning(f"[match-ingredients] No store deal data found under {settings.data_dir / 'stores'} "
                        "— run a scrape first (e.g. `python main.py`).")
        return

    recipes = parse_recipe_ingredients(_RECIPES_DIR)
    if not recipes:
        logger.warning(f"[match-ingredients] No recipes with an '## Ingredients' section found under {_RECIPES_DIR}")
        return

    if client is None:
        client = get_llm_client()

    logger.info(f"[match-ingredients] {len(all_deals)} deals loaded, {len(recipes)} recipes to match")

    # First pass: match every recipe's ingredients against our own scraped
    # data, and note which ingredients came back weak/empty — those (and
    # only those) get a keyword queued for the live supermarktscanner.nl
    # fallback, deduped so each distinct keyword is only looked up once
    # regardless of how many recipes/ingredients share it.
    per_recipe_entries: Dict[str, List[dict]] = {}
    fallback_keywords: Set[str] = set()

    for slug, ingredient_lines in recipes.items():
        matched = match_ingredients_to_deals(ingredient_lines, all_deals, client=client, model=settings.llm_model)
        entries = []
        for line in ingredient_lines:
            own_matches = [{**m, "bron": "eigen-data"} for m in matched.get(line, [])]
            keyword = extract_keyword(line)
            entries.append({"raw": line, "matches": own_matches, "keyword": keyword})
            if len(own_matches) < _WEAK_MATCH_THRESHOLD and keyword:
                fallback_keywords.add(keyword)
        per_recipe_entries[slug] = entries
        logger.info(f"[match-ingredients] {slug}: {len(ingredient_lines)} ingredients, "
                    f"{sum(1 for e in entries if e['matches'])} with an own-data match")

    logger.info(f"[match-ingredients] {len(fallback_keywords)} distinct keyword(s) need a "
                f"supermarktscanner.nl fallback lookup")
    # supermarktscanner.nl is a Dutch site — searching the raw English keyword
    # ("ginger", "onion") mostly returns nothing, so translate first (same
    # translation match_ingredients_to_deals already uses for its own
    # shortlisting) and query that Dutch word instead. Still try the original
    # keyword too if the translated query comes up empty, in case it's e.g. a
    # brand name the translator declined to change but that still works as a
    # search term some other way.
    fallback_cache: Dict[str, List[dict]] = {}
    for kw in sorted(fallback_keywords):
        translated = translate_keyword_to_dutch(kw, client, settings.llm_model)
        query = translated or kw
        results = fetch_ingredient_prices(query)
        if not results and query != kw:
            results = fetch_ingredient_prices(kw)
        fallback_cache[kw] = results

    # Second pass: attach fallback results to the same weak/empty ingredients.
    output_recipes = {}
    for slug, entries in per_recipe_entries.items():
        out_ingredients = []
        for entry in entries:
            matches = list(entry["matches"])
            if len(matches) < _WEAK_MATCH_THRESHOLD and entry["keyword"]:
                matches.extend(fallback_cache.get(entry["keyword"], []))
            # Re-sort cheapest-first (nulls last) now that fallback results
            # may have been appended after the already-sorted own-data ones.
            matches.sort(key=lambda m: (m.get("actieprijs") is None, m.get("actieprijs")))
            out_ingredients.append({"raw": entry["raw"], "matches": matches})
        output_recipes[slug] = {"ingredients": out_ingredients}

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "recipes": output_recipes,
    }

    settings.data_dir.mkdir(parents=True, exist_ok=True)
    out_path = settings.data_dir / "ingredient-matches.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    total_ingredients = sum(len(v["ingredients"]) for v in output_recipes.values())
    total_matched = sum(1 for v in output_recipes.values() for e in v["ingredients"] if e["matches"])
    logger.info(f"[match-ingredients] Wrote {out_path} — {len(output_recipes)} recipes, "
                f"{total_ingredients} ingredients, {total_matched} with >=1 match (own data or fallback)")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="supermarktscanner.nl deal scraper → JSON export for static site",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--no-scrape",
        action="store_true",
        help="Skip the deals-overview scrape (useful with --match-ingredients alone)",
    )
    parser.add_argument(
        "--no-export",
        action="store_true",
        help="Extract deals but skip JSON export (useful for testing)",
    )
    parser.add_argument(
        "--categorize",
        action="store_true",
        help="Tag each deal with a category via the local LLM (see modules/categorizer.py) before export",
    )
    parser.add_argument(
        "--match-ingredients",
        action="store_true",
        help=(
            "Match every recipe's ingredients (../_recipes/*.md) against current deals via the local LLM "
            "(see modules/ingredient_matcher.py), falling back to a live supermarktscanner.nl keyword lookup "
            "for weak/no matches, and write ../public/data/ingredient-matches.json. Reads store deals from "
            "disk (../public/data/stores/*.json) rather than requiring a fresh scrape in the same run."
        ),
    )
    args = parser.parse_args()

    do_scrape = not args.no_scrape

    # Only initialise the LLM client if categorization/ingredient-matching was requested.
    needs_llm = args.categorize or args.match_ingredients
    client = get_llm_client() if needs_llm else None

    logger.info("═" * 64)
    logger.info("  supermarktscanner.nl Deal Scraper")
    if client:
        logger.info(f"  LLM: {settings.llm_base_url}  model={settings.llm_model}")
    logger.info("═" * 64)

    if do_scrape:
        logger.info("\n── supermarktscanner.nl ── beste-supermarkt-aanbiedingen " + "─" * 6)
        all_deals = fetch_deals_overview()
        logger.info(f"[supermarktscanner] ✓ {len(all_deals)} deals extracted")

        if args.categorize and all_deals:
            newly_tagged = categorize_deals(all_deals, client=client, model=settings.llm_model)
            total_categorized = sum(1 for d in all_deals if d.categorie)
            logger.info(f"[supermarktscanner] Categorized {total_categorized}/{len(all_deals)} deals "
                        f"({newly_tagged} via LLM, rest already had one)")

        grouped = _group_by_store(all_deals)

        if not args.no_export:
            for store_name, store_deals in grouped.items():
                export_store(store_name, _MODE, store_deals, settings.data_dir)
                logger.info(f"[{store_name}] Exported {len(store_deals)} deals to JSON")
            logger.info(f"Pipeline complete — JSON exported to {settings.data_dir}")
        elif all_deals:
            logger.info("Export skipped (--no-export). Sample output (first 5 deals):")
            for deal in all_deals[:5]:
                logger.info(f"  {deal.model_dump()}")

        logger.info(f"\n{'═' * 64}")
        logger.info(f"  Grand total: {len(all_deals)} deals across {len(grouped)} stores")
        logger.info(f"{'═' * 64}")

        if not all_deals:
            logger.warning("No deals found. The site may be unreachable or its layout may have changed — "
                            "see modules/supermarktscanner_connector.py.")
    else:
        logger.info("Scrape skipped (--no-scrape).")

    if args.match_ingredients:
        _run_match_ingredients(client)


if __name__ == "__main__":
    main()
