# Backend — supermarktscanner.nl Deal Scraper

Scrapes [supermarktscanner.nl](https://www.supermarktscanner.nl)'s curated
"beste supermarkt aanbiedingen" (best deals this week) page — a cross-store
best-deals listing spanning many Dutch supermarkets at once — and exports the
result as structured JSON into `public/data/` for the static dashboard site
to consume. supermarktscanner.nl is the app's **only** deals source; there is
no per-store scraping and no PDF/vision-LLM pipeline.

See [`modules/supermarktscanner_connector.py`](modules/supermarktscanner_connector.py)
for the connector itself — it's a plain headless-browser DOM read (Playwright),
no vision LLM involved anywhere in the deals pipeline. The site returns a
curated selection (~80 items at a time, no pagination), not a full per-store
catalog, so expect noticeably fewer items per store than a dedicated
per-store scraper would return.

## Install

```bash
pip install -r requirements.txt
python -m playwright install chromium
```

## Configure

An LLM is only needed for the optional `--categorize` and `--match-ingredients`
passes (see below) — the deals scrape itself needs no LLM at all.

```bash
cp .env.template .env
```

Edit `.env` to point at your LLM endpoint/model if you plan to use either of
those flags.

## Usage

```bash
python main.py                                       # scrape supermarktscanner.nl, export JSON
python main.py --categorize                          # also tag each deal with a category via the local LLM
python main.py --no-export                           # scrape only, skip JSON export (useful for testing)
python main.py --no-scrape --match-ingredients        # skip the scrape, just re-run ingredient matching
```

`--categorize` runs `modules/categorizer.py`: batches of 20 product names are
sent to your local LLM (`LLM_MODEL` in `.env`) asking it to pick one of a
fixed Dutch category list (Groente & Fruit, Vlees & Vis, Zuivel & Eieren,
Dranken, ...) per product; the result is written to each deal's `categorie`
field. If you're on Ollama with a hybrid-reasoning model (Qwen3-family models
default to "thinking" mode), this module talks to Ollama's native
`/api/chat` with `think: false` — without that, the model burns its entire
token budget on internal reasoning before ever producing the JSON answer. It
falls back to a plain OpenAI-compatible call for non-Ollama backends, without
that optimization.

Deals are grouped by store and exported to
`../public/data/stores/<slug>.json` (e.g. `albert-heijn.json`), and
`../public/data/index.json` is updated with a manifest entry for each store
that had at least one deal in this run. A store that doesn't appear in the
current scrape simply keeps whatever data it had from the last run that
included it — nothing is wiped.

## Ingredient matching (`--match-ingredients`)

`main.py --match-ingredients` (see `modules/ingredient_matcher.py`) matches
every recipe's ingredients (`../_recipes/*.md`) against currently exported
deals via the local LLM, and writes `../public/data/ingredient-matches.json`
for the frontend's per-ingredient price lookup. It reads store deals from
disk (`../public/data/stores/*.json`) rather than requiring a fresh scrape in
the same run, so it can be run standalone.

Because the curated deals-overview page only covers a fraction of all
grocery products, most ingredients get few or no matches against that data
alone — for any ingredient with fewer than 2 own-data matches, this module
automatically falls back to a live keyword lookup against
supermarktscanner.nl's per-product page
(`fetch_ingredient_prices()` in `modules/supermarktscanner_connector.py`,
e.g. `/product.php?keyword=Tomaten` for tomatoes), which searches across many
more supermarkets than the deals-overview page ever surfaces. Recipe
ingredient text is often English while supermarktscanner.nl is a Dutch site,
so the keyword is translated to Dutch via the local LLM first
(`translate_keyword_to_dutch`) before the lookup.

## Automation notes

The daily scheduled run ([`.github/workflows/update-and-deploy.yml`](../.github/workflows/update-and-deploy.yml)
at the repo root) needs no LLM — it just runs `python main.py` (Playwright's
Chromium only) and commits whatever changed under `public/data/`. The
`--categorize` and `--match-ingredients` passes both need a local LLM
(Ollama/LM Studio), so they're local-only — run them yourself and push the
result when you want deal categories or ingredient prices refreshed on the
live site.
