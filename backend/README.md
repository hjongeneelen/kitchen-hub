# Backend — Dutch Supermarket Deal Scraper

Pulls weekly folder deals from 19 Dutch retailers and exports structured JSON
into `public/data/` for the static dashboard site to consume. This is
a fork of an earlier Google Sheets–based scraper, with the Sheets upload step
replaced by a plain JSON exporter (`modules/exporter.py`).

Two processing modes per store:
- `api` — structured JSON API, or a headless-browser (Playwright) DOM read of
  the store's own deals page (or, for Hoogvliet/Poiesz/Dekamarkt/Vomar, of
  supermarktscanner.nl's mirror of that store's page) — no vision LLM needed
  either way (Albert Heijn, Lidl, Dirk, Jumbo, Plus, Aldi, Hoogvliet, Poiesz,
  Dekamarkt, Vomar). All of these also carry a product photo URL now (see
  "Product images" below).
- `pdf` — download PDF → pdf2image → vision LLM → parse (9 stores)

## Install

```bash
pip install -r requirements.txt
python -m playwright install chromium   # needed for the Jumbo/Plus/Aldi connectors
```

**Windows + PDF stores:** `pdf2image` requires Poppler on `PATH`. Download from
https://github.com/oschwartz10612/poppler-windows/releases, extract, and add
the `Library/bin` folder to your system `PATH`.

**Vision LLM stores:** install [Ollama](https://ollama.com) and pull a vision
model, e.g. `ollama pull llava:13b` (any vision-capable model works — set
`LLM_MODEL` in `.env` to whatever you have pulled, e.g. `qwen3.5:9b`). The
connector talks to Ollama's OpenAI-compatible API at `http://localhost:11434/v1`
by default.

## Configure

```bash
cp .env.template .env
```

Edit `.env` to point at your LLM endpoint/model and, optionally, override
per-store PDF URLs (auto-discovery works for most stores; a few need a
manually pasted URL — see comments in `.env.template`).

## Usage

```bash
python main.py                                       # all stores, full JSON export
python main.py --stores jumbo hoogvliet              # only these stores
python main.py --categorize                          # also tag each deal with a category via the local LLM
python main.py --no-export                           # extract only, skip JSON export
python main.py --clear-cache                          # force re-download PDFs
python main.py --list-stores                          # show all configured stores
python main.py --essentials                          # live current prices for essentials.txt's keywords -> public/data/essentials.json
```

`--categorize` runs `modules/categorizer.py`: batches of 20 product names are
sent to your local LLM (`LLM_MODEL` in `.env`) asking it to pick one of a
fixed Dutch category list (Groente & Fruit, Vlees & Vis, Zuivel & Eieren,
Dranken, ...) per product; the result is written to each deal's `categorie`
field. Tested at ~2000 deals in ~5 minutes with `qwen3.5:9b`. If you're on
Ollama with a hybrid-reasoning model (Qwen3-family models default to
"thinking" mode), this module talks to Ollama's native `/api/chat` with
`think: false` — without that, the model burns its entire token budget on
internal reasoning before ever producing the JSON answer (confirmed: a
3-item batch used all 2048 tokens thinking and returned nothing). It falls
back to a plain OpenAI-compatible call for non-Ollama backends, without that
optimization.

Each store's deals are exported immediately after processing to
`../public/data/stores/<slug>.json` (e.g. `albert-heijn.json`), and
`../public/data/index.json` is updated with a manifest entry for that
store. This means an interrupted run still persists whichever stores finished,
and other stores' data is never wiped by a partial `--stores` run.

## Automation notes

- **Albert Heijn, Lidl, Dirk, Jumbo, Plus, Aldi, Hoogvliet, Poiesz, Dekamarkt,
  and Vomar** (`api` mode) need no local vision LLM — fully automatable in
  CI/a scheduled job (see `.github/workflows/update-and-deploy.yml` at the
  repo root, which runs this on a daily cron). Jumbo/Plus/Aldi/Lidl/Hoogvliet/
  Poiesz/Dekamarkt/Vomar specifically need Playwright's Chromium
  (`python -m playwright install chromium`) since they work by rendering a
  page with a real headless browser rather than calling an API. Jumbo's
  group-deal expansion in particular makes it the slowest connector by far
  (~7 minutes, dozens of extra page visits) — budget for that in any
  automation you build on top of this.
- **The other 9 stores** (`pdf` mode) need a local vision LLM via Ollama, so
  they must be run locally (or on a machine with Ollama installed) and their
  output JSON committed into `public/data/` for the static site to
  pick up. Auto-discovery of the weekly PDF URL currently fails for all of
  them (see below) — you'll need to paste a URL manually in `.env` for now.
- **`--essentials`** is a separate, independent pass (like `--match-ingredients`)
  that looks up current prices for a curated list of everyday staples
  (`essentials.txt`, one Dutch keyword per line, hand-editable — add anything
  you actually buy) via a live supermarktscanner.nl search per keyword —
  regardless of whether anything is actually on sale. Playwright-only, no LLM,
  safe to run in CI daily alongside the structured-store scrape. Answers
  "what does tomato sauce cost right now" even on weeks nobody's flyer covers it.

## Product images

`DealItem.afbeelding_url` (optional) is populated for every `api`-mode
connector: Albert Heijn and Dirk pull it straight out of their own JSON/embedded
payload (a CDN URL already present, just not previously extracted — AH:
`product["images"]`, largest width; Dirk: the linked product's
`productInformation.image`, prefixed with `https://web-fileserver.dirk.nl/`);
Jumbo/Plus/Aldi/Lidl read an `<img src>` already present in each deal card's
DOM (`[data-testid="jum-card-image"] img` / `.plp-item-image-container img` /
`.product-tile__image-section img` / `.odsc-image-gallery img` respectively —
Plus's CDN emits protocol-relative `//...` URLs, normalized to `https://`);
Hoogvliet/Poiesz/Dekamarkt/Vomar and `--essentials` get theirs from
supermarktscanner.nl's `.cbp-pgitem-flip img` (excluding the `.copyright-img`
watermark). `pdf`/vision-LLM stores don't have one — the frontend (`DealCard.jsx`)
shows a muted placeholder icon instead when `afbeelding_url` is absent or fails
to load, so the grid stays visually consistent either way.

## Connector status

- **Albert Heijn**: works. AH's product-search API requires a short-lived
  anonymous bearer token (fetched automatically); the connector pages through
  search results and keeps items carrying bonus fields. No API key needed.
- **Dirk**: works. Dirk's `aanbiedingen` page is server-rendered (Nuxt) with
  the full current-offers dataset embedded in the page's `__NUXT_DATA__`
  payload — `modules/dirk_connector.py` decodes that devalue-style payload
  directly with a plain GET, no auth needed. (Dirk's GraphQL API also exists
  at `web-gateway.dirk.nl` but returns empty results without a browser
  session — the embedded payload sidesteps that.)
- **Jumbo, Plus, Aldi, Lidl**: work, via a different technique than AH/Dirk.
  Their APIs/backends are bot-protected (Akamai/Imperva — see below), but
  their consumer-facing deals pages render completely normally for a real
  browser; the blocking is on the API traffic pattern, not on loading the
  page. `modules/jumbo_connector.py`, `plus_connector.py`, `aldi_connector.py`,
  and `lidl_connector.py` each launch headless Chromium via Playwright, load
  the store's own page, dismiss the cookie banner where present, and read
  the deal cards straight out of the rendered DOM (`page.locator(...)` +
  `.inner_text()`) — no OCR/vision model involved, since it's real HTML once
  rendered.
  - Aldi (195 items) returns everything its own `/aanbiedingen` page shows —
    confirmed with `window.scrollTo` down to a stable page height (5
    consecutive unchanged heights) that no more cards load.
  - Jumbo's `/aanbiedingen/nu` page IS lazy-loaded, but deceptively so: a
    shallow scroll (a handful of `mouse.wheel` ticks, or ~5 scroll-to-bottom
    rounds) looks fully loaded at ~24 cards and then jumps to 100+ once you
    keep scrolling past that point. `jumbo_connector.py` scrolls until the
    page height is stable across 5 consecutive rounds (up to 60 rounds)
    before reading cards. About a third of its cards are "Alle X" group
    deals (e.g. "Alle Jumbo groene salades") covering several specific
    products at one price — each one's detail page lists the individual
    products with their own name/price/size, so we visit it and expand the
    group into one DealItem per product. End result: ~700 items instead of
    the ~24 the naive first read gave.
    - We separately tried Jumbo's `/producten/alle-aanbiedingen/` catalog (a
      different, larger ~1300-item listing with richer per-item data — pack
      sizes embedded in the title). Its pagination is a genuine dead end for
      a headless browser: neither navigating `?page=N` directly nor
      clicking the page-N button (even with a realistic mouse move + down/
      up, not just a synthetic click) changes the rendered results or fires
      a request — the app silently no-ops it. That smells like it's
      specifically gating scripted interaction, so we didn't push further
      into working around it, and stuck with the `/nu` page instead.
  - Plus's `/aanbiedingen` page has two tabs — "t/m dinsdag" (this week) and
    "Vanaf woensdag" (next week) — covering different validity periods with
    mostly different products; we read both (~40 items combined, varies —
    Plus's live inventory changes between runs, this isn't a fixed number).
  - Lidl's `/c/aanbiedingen/a10008785` page publishes offers in three weekly
    waves, each its own tab (Maandag/Woensdag/Vrijdag — very different sizes:
    ~12/~92/~104 tiles), so we click through all three (~198 items combined).
    Each tile carries a `data-gridbox-impression` attribute — a URL-encoded
    JSON blob with the exact name, price, and **Lidl's own category
    taxonomy** (`wonCategoryPrimary`, e.g. "Werelden van
    nood/Eten.../Diepvriesvoeding/Diepvriespizza's & snacks") — cleaner than
    scraping visible text, and it means Lidl deals get `categorie` mapped
    straight from Lidl's own data (`_CATEGORY_KEYWORDS` in
    `lidl_connector.py`) instead of costing an LLM call (184/198 tagged this
    way in one run). Like Jumbo, ~a third of Lidl's tiles are "Alle X" group
    deals; their detail page's `window.__NUXT__` data has empty
    `variants`/`setItems` fields (checked directly), so instead we expand
    them from each variant image's descriptive `alt` text (e.g. "800g
    runder hamburgers in een voordeelverpakking.") — good enough for
    distinct name + size, but no exact per-variant price (left null, with
    the group's price-range text kept as `korting_tekst`).
- **Hoogvliet, Poiesz, Dekamarkt, Vomar**: work, via a third technique —
  instead of these stores' own sites (Hoogvliet's and Dekamarkt's are Publitas
  PDF folders we'd otherwise need the vision-LLM path for; Poiesz and Vomar
  aren't even in the original 18-store list), `modules/supermarktscanner_connector.py`'s
  `fetch_store_deals(slug, store_name)` renders supermarktscanner.nl's own
  `/{slug}-aanbiedingen` page (confirmed to exist for all four, plus
  AH/Jumbo/Dirk/Plus which we already get more directly) and reads the same
  `li.product-entry` DOM the ingredient-price fallback already parses — no
  vision LLM, no OCR. Also captures a product photo (`.cbp-pgitem-flip img`,
  excluding the `.copyright-img` watermark — real URL in `data-lazy` on
  lazy-loaded rows) and the discount's "was" price (`.pgpricediscount`) and
  validity window (`.pgdiscountdate`). Poiesz and Vomar can legitimately
  return 0 deals some weeks — supermarktscanner.nl itself requires 6 weeks of
  price history before it'll list a store's offers, and says so on the page
  when that's not met yet; this isn't a scraper bug, just an empty week
  (confirmed: Dekamarkt returned 8 real deals, Vomar 0, on the same day).
- **Coop, Kruidvat, Etos investigated, no automated path found**: Coop NL's
  own site has been decommissioned (redirects to plus.nl — Coop NL was
  acquired by Plus Retail), so there's no page left to render. Kruidvat and
  Etos are blocked by Akamai Bot Manager even for a real headless browser
  (unlike Jumbo/Plus/Aldi, which only blocked the raw API) — getting past
  that would mean specifically working around bot detection rather than just
  rendering a public page normally, which we're deliberately not pursuing.
  All three remain on the PDF + vision-LLM path.
