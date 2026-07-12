"""
Dutch Supermarket Deal Scraper
──────────────────────────────
Pulls weekly folder deals from 18 Dutch retailers, extracts structured data,
and exports it as JSON for the static dashboard site (public/data/)
instead of pushing to a Google Sheet.

Two processing modes per store:
  pdf  → download PDF → pdf2image → Vision LLM → parse → JSON export
  api  → structured JSON API, or a headless-browser DOM read of the store's
         own deals page, no vision LLM needed either way
         (Albert Heijn, Lidl, Dirk, Jumbo, Plus, Aldi)

Usage:
  python main.py                                    # all stores, full export
  python main.py --stores jumbo hoogvliet           # only these stores
  python main.py --categorize                      # also tag each deal with a category via the local LLM
  python main.py --no-export                        # extract only, skip JSON export
  python main.py --clear-cache                      # force re-download PDFs
  python main.py --list-stores                      # show all configured stores
  python main.py --match-ingredients                # match _recipes/*.md ingredients to current deals (reads
                                                      # ../public/data/stores/*.json from disk — no scrape needed;
                                                      # standalone unless combined with --stores)
"""

import argparse
import json
import logging
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Literal, Optional, Set

from openai import OpenAI

from config import settings
from modules.ah_connector import fetch_ah_deals
from modules.aldi_connector import fetch_aldi_deals
from modules.categorizer import categorize_deals
from modules.converter import pdf_to_images
from modules.dirk_connector import fetch_dirk_deals
from modules.downloader import download_pdf
from modules.exporter import export_store
from modules.ingredient_matcher import extract_keyword, match_ingredients_to_deals, parse_recipe_ingredients, translate_keyword_to_dutch
from modules.jumbo_connector import fetch_jumbo_deals
from modules.lidl_connector import fetch_lidl_deals
from modules.llm_connector import extract_deals_from_image, get_llm_client
from modules.models import DealItem
from modules.parser import parse_llm_response
from modules.plus_connector import fetch_plus_deals
from modules.supermarktscanner_connector import fetch_ingredient_prices
from scrapers.base import BaseScraper
from scrapers.hoogvliet import HoogvlietScraper
from scrapers.kruidvat import KruidvatScraper
from scrapers.publitas import PublitasScraper

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


# ── Store registry ────────────────────────────────────────────────────────────

@dataclass
class StoreConfig:
    name: str
    mode: Literal["pdf", "api"]
    # For pdf mode: optional manual URL override, optional scraper
    env_url: Optional[str] = None
    scraper: Optional[BaseScraper] = None
    # For api mode: callable that returns deals directly
    api_fn: Optional[Callable[[], List[DealItem]]] = None
    # Human-readable note shown in --list-stores
    note: str = ""


STORES: List[StoreConfig] = [
    # ── Tier A: Fully automatable ─────────────────────────────────────────────
    StoreConfig(
        name="Hoogvliet",
        mode="pdf",
        env_url=settings.hoogvliet_pdf_url,
        scraper=HoogvlietScraper(),
        note="Week-number URL (folder_YYYY_WW) — fully auto",
    ),
    StoreConfig(
        name="Boni",
        mode="pdf",
        env_url=settings.boni_pdf_url,
        scraper=PublitasScraper("Boni", "boni-supermarkt"),
        note="Publitas redirect — fully auto",
    ),
    StoreConfig(
        name="Poiesz",
        mode="pdf",
        env_url=settings.poiesz_pdf_url,
        scraper=PublitasScraper("Poiesz", "okkinga-communicatie"),
        note="Publitas redirect — fully auto (Friesland/Groningen)",
    ),
    StoreConfig(
        name="DA Drogist",
        mode="pdf",
        env_url=settings.da_drogist_pdf_url,
        scraper=PublitasScraper("DA Drogist", "da-drogisterij"),
        note="Publitas redirect — bi-weekly folder",
    ),
    # ── Tier B: Publitas API ──────────────────────────────────────────────────
    StoreConfig(
        name="Coop",
        mode="pdf",
        env_url=settings.coop_pdf_url,
        scraper=PublitasScraper("Coop", "coop-supermarkten"),
        note="Publitas (coop-supermarkten) — full + Compact folder. "
             "Coop NL's own site now redirects to plus.nl (acquired by Plus Retail); "
             "this folder may stop updating at some point.",
    ),
    StoreConfig(
        name="Kruidvat",
        mode="pdf",
        env_url=settings.kruidvat_pdf_url,
        scraper=KruidvatScraper(),
        note="Publitas group ID 189",
    ),
    StoreConfig(
        name="Etos",
        mode="pdf",
        env_url=settings.etos_pdf_url,
        scraper=PublitasScraper("Etos", "etos", base_url="https://folder.etos.nl"),
        note="Publitas custom domain — bi-weekly folder",
    ),
    StoreConfig(
        name="Nettorama",
        mode="pdf",
        env_url=settings.nettorama_pdf_url,
        scraper=PublitasScraper("Nettorama", "91409"),
        note="Publitas group ID 91409",
    ),
    StoreConfig(
        name="Dekamarkt",
        mode="pdf",
        env_url=settings.dekamarkt_pdf_url,
        scraper=PublitasScraper("Dekamarkt", "dekamarkt", base_url="https://folder.dekamarkt.nl"),
        note="Publitas custom domain — Noord-Holland regional",
    ),
    StoreConfig(
        name="Blokker",
        mode="pdf",
        env_url=settings.blokker_pdf_url,
        scraper=PublitasScraper("Blokker", "blokker"),
        note="Publitas (blokker) — housewares",
    ),
    StoreConfig(
        name="Gamma",
        mode="pdf",
        env_url=settings.gamma_pdf_url,
        scraper=PublitasScraper("Gamma", "gamma-nl", base_url="https://folder.gamma.nl"),
        note="Publitas custom domain — DIY/hardware",
    ),
    StoreConfig(
        name="Praxis",
        mode="pdf",
        env_url=settings.praxis_pdf_url,
        scraper=PublitasScraper("Praxis", "10", base_url="https://folder.praxis.nl"),
        note="Publitas custom domain — DIY/hardware",
    ),
    # ── Structured (no vision LLM) ────────────────────────────────────────────
    StoreConfig(
        name="Albert Heijn",
        mode="api",
        api_fn=fetch_ah_deals,
        note="Mobile API (anonymous token) — structured data, no vision LLM needed",
    ),
    StoreConfig(
        name="Lidl",
        mode="api",
        api_fn=fetch_lidl_deals,
        note="Schwarz CDN API — currently dead, see backend/README.md",
    ),
    StoreConfig(
        name="Dirk",
        mode="api",
        api_fn=fetch_dirk_deals,
        note="Offers embedded in the aanbiedingen page's __NUXT_DATA__ payload — no auth, no vision LLM needed",
    ),
    StoreConfig(
        name="Jumbo",
        mode="api",
        api_fn=fetch_jumbo_deals,
        note="Headless-browser DOM read of jumbo.com/aanbiedingen/nu — API is Akamai-blocked, the page itself isn't",
    ),
    StoreConfig(
        name="Plus",
        mode="api",
        api_fn=fetch_plus_deals,
        note="Headless-browser DOM read of plus.nl/aanbiedingen — no public API found, page renders fine",
    ),
    StoreConfig(
        name="Aldi",
        mode="api",
        api_fn=fetch_aldi_deals,
        note="Headless-browser DOM read of aldi.nl/aanbiedingen.html — legacy API is dead, page renders fine",
    ),
]

_STORE_NAMES_LOWER = {s.name.lower().replace(" ", "-"): s.name for s in STORES}


# ── Per-store processing ──────────────────────────────────────────────────────

def _process_via_llm(
    images: List,
    store_name: str,
    client: OpenAI,
) -> List[DealItem]:
    """Run a list of PIL Images through the vision LLM and collect deals."""
    deals: List[DealItem] = []
    for page_num, image in enumerate(images, start=1):
        try:
            raw = extract_deals_from_image(image, store_name, client)
            page_deals = parse_llm_response(raw, store_name, page_num)
            deals.extend(page_deals)
            logger.info(f"[{store_name}] Page {page_num}: {len(page_deals)} deals")
        except Exception as e:
            logger.error(f"[{store_name}] Page {page_num} failed and was skipped: {e}")
    return deals


def _run_store(store: StoreConfig, client: Optional[OpenAI]) -> List[DealItem]:
    """Dispatch to the right processing path based on store.mode."""

    # ── API mode: structured JSON, no LLM ────────────────────────────────────
    if store.mode == "api":
        assert store.api_fn is not None
        return store.api_fn()

    # ── PDF mode ──────────────────────────────────────────────────────────────
    pdf_url = store.env_url
    if not pdf_url and store.scraper:
        logger.info(f"[{store.name}] No URL in .env — running auto-discovery...")
        pdf_url = store.scraper.discover_pdf_url()

    if not pdf_url:
        logger.warning(f"[{store.name}] No PDF URL available — skipping.")
        return []

    pdf_path = download_pdf(pdf_url, store.name)
    if not pdf_path:
        logger.warning(f"[{store.name}] PDF download failed — skipping.")
        return []

    images = list(pdf_to_images(pdf_path, store.name))
    if not images:
        return []
    # pdf_to_images yields (page_num, image) tuples
    pil_images = [img for _, img in images]
    return _process_via_llm(pil_images, store.name, client)


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
        description="Dutch supermarket deal scraper → JSON export for static site",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--clear-cache",
        action="store_true",
        help="Delete all cached PDFs and re-download from scratch",
    )
    parser.add_argument(
        "--stores",
        nargs="+",
        metavar="STORE",
        help=(
            "Process only these stores (default: all). "
            "Use lowercase with hyphens, e.g.: jumbo hoogvliet albert-heijn"
        ),
    )
    parser.add_argument(
        "--no-export",
        action="store_true",
        help="Extract deals but skip JSON export (useful for testing)",
    )
    parser.add_argument(
        "--list-stores",
        action="store_true",
        help="Print all configured stores with their modes and exit",
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
            "(see modules/ingredient_matcher.py), falling back to a live supermarktscanner.nl lookup for "
            "weak/no matches, and write ../public/data/ingredient-matches.json. Reads store deals from disk "
            "(../public/data/stores/*.json) rather than requiring a fresh scrape in the same run — runs "
            "standalone unless combined with --stores."
        ),
    )
    args = parser.parse_args()

    if args.list_stores:
        print(f"\n{'Store':<20} {'Mode':<6} Note")
        print("─" * 70)
        for s in STORES:
            url_marker = " [URL set]" if s.env_url else ""
            print(f"  {s.name:<18} {s.mode:<6} {s.note}{url_marker}")
        print()
        return

    if args.clear_cache and settings.cache_dir.exists():
        shutil.rmtree(settings.cache_dir)
        logger.info("PDF cache cleared.")

    # Resolve which stores to run
    if args.stores:
        selected_names = set()
        for arg in args.stores:
            canonical = _STORE_NAMES_LOWER.get(arg.lower())
            if canonical:
                selected_names.add(canonical)
            else:
                logger.warning(f"Unknown store '{arg}' — ignoring. Run --list-stores to see options.")
        active_stores = [s for s in STORES if s.name in selected_names]
    elif args.match_ingredients:
        # --match-ingredients reads store data straight from disk (see
        # _load_all_deals) rather than needing a fresh scrape in the same
        # run, so on its own it shouldn't implicitly trigger a full scrape
        # of all 18 stores. Pass --stores explicitly to also scrape before
        # matching.
        active_stores = []
    else:
        active_stores = STORES

    # Only initialise the LLM client if we have at least one pdf store, or categorization/ingredient-matching was requested
    needs_llm = any(s.mode == "pdf" for s in active_stores) or args.categorize or args.match_ingredients
    client = get_llm_client() if needs_llm else None

    logger.info("═" * 64)
    logger.info("  Dutch Supermarket Deal Scraper")
    if client:
        logger.info(f"  LLM: {settings.llm_base_url}  model={settings.llm_model}")
    logger.info(f"  Stores: {', '.join(s.name for s in active_stores)}")
    logger.info("═" * 64)

    all_deals: List[DealItem] = []

    if active_stores:
        for store in active_stores:
            logger.info(f"\n── {store.name} {'─' * max(1, 52 - len(store.name))}")
            try:
                store_deals = _run_store(store, client)
                logger.info(f"[{store.name}] ✓ {len(store_deals)} deals extracted")
                all_deals.extend(store_deals)

                if args.categorize and store_deals:
                    newly_tagged = categorize_deals(store_deals, client=client, model=settings.llm_model)
                    total_categorized = sum(1 for d in store_deals if d.categorie)
                    logger.info(f"[{store.name}] Categorized {total_categorized}/{len(store_deals)} deals "
                                f"({newly_tagged} via LLM, rest already had one)")

                if not args.no_export:
                    export_store(store.name, store.mode, store_deals, settings.data_dir)
                    logger.info(f"[{store.name}] Exported {len(store_deals)} deals to JSON")
            except Exception as e:
                logger.error(f"[{store.name}] Unexpected error — store skipped: {e}")

        logger.info(f"\n{'═' * 64}")
        logger.info(f"  Grand total: {len(all_deals)} deals across {len(active_stores)} stores")
        logger.info(f"{'═' * 64}")

        if not all_deals:
            logger.warning("No deals found. Check your .env URLs and LLM endpoint.")
        elif args.no_export:
            logger.info("Export skipped (--no-export).")
            logger.info("Sample output (first 5 deals):")
            for deal in all_deals[:5]:
                logger.info(f"  {deal.model_dump()}")
        else:
            logger.info(f"Pipeline complete — JSON exported to {settings.data_dir}")
    else:
        logger.info("No stores selected for scraping this run.")

    if args.match_ingredients:
        _run_match_ingredients(client)


if __name__ == "__main__":
    main()
