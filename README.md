# Kitchen Hub

A 100% static, free-to-host recipe app — Vite + React + Tailwind CSS, recipes
as plain Markdown files with frontmatter — merged with a live Dutch
grocery-deals dashboard (originally two separate projects,
[recipe-app](https://github.com/hjongeneelen/recipe-app) and
[boodschappen-dashboard](https://github.com/hjongeneelen/boodschappen-dashboard))
so you can see which of a recipe's ingredients are currently on sale, and
where.

- **Recipes** work exactly as before — see below.
- **Deals** (`/#/deals`) is a searchable, filterable grid of current
  supermarket deals sourced from supermarktscanner.nl's curated best-deals
  page (spanning many Dutch stores at once), refreshed daily via GitHub
  Actions. See [`backend/README.md`](backend/README.md) for how that pipeline
  works.
- **Ingredient prices**: each recipe page shows, per ingredient, the cheapest
  current match against that deals data (and a broader per-product
  supermarktscanner.nl lookup when the curated deals data doesn't have a good
  match — see `backend/README.md`). This is precomputed locally (`python
  backend/main.py --match-ingredients`, needs Ollama) into a static JSON
  file — like the rest of this app, the deployed site never makes a live
  LLM/API call.
- **Pantry staples** (`/#/pantry`): a persistent list of ingredients you
  always have (onion, garlic, oil, ...) — auto-checked on every recipe page
  and excluded from cost estimates, since you don't need to buy them. Works
  fully in production (just localStorage, no LLM) — unlike the Fridge/Editor
  chat tools below, which need a locally-running dev server.
- **Shopping list** (`/#/shopping-list`): pick which recipes you're making
  this week and get one combined list, merged and grouped by store, with a
  running total.
- **Installable**: the site is a PWA — "Add to Home Screen" gives it an app
  icon, and recipes/previously-loaded deal data stay available offline.

## Adding a recipe

Drop a new `.md` file into [`_recipes/`](_recipes/) using this shape:

```md
---
title: My Recipe
prepTime: 30 min
portions: 4
tags: [tag-one, tag-two]
description: One sentence shown on the recipe card.
---

## Ingredients

- 500 g ingredient
- 1/2 tsp another ingredient

## Preparation

1. First step.
2. Second step.
```

- Use metric units throughout (g, kg, ml, l, cm, °C) plus normal spoon
  measurements (tsp, tbsp) — no cups, inches, ounces, pounds, or °F. The local
  LLM editor is instructed to follow this convention automatically.
- `tags` power the home page filter chips and show up as `#hashtags` on each
  recipe.
- Numbers in the `## Ingredients` list (whole numbers, fractions like `1/2`, and
  mixed numbers like `1 1/2`) are auto-detected and scaled by the portion counter
  on the recipe page.
- `aubergine`, `mushroom(s)`/`champignon(s)`, `ricotta`, `feta`, and `olive(s)`
  are automatically flagged with a highlight — edit the list in
  [`src/lib/safetyFlags.js`](src/lib/safetyFlags.js) to match what you personally avoid.
- Recipes are discovered automatically at build time via `import.meta.glob` — no
  registry file to keep in sync.

## Language

The language dropdown in the header (English / Nederlands / Français /
Deutsch) switches both the app's own text (headings, buttons, search
placeholder) **and** recipe content, if the recipe provides a translation.
To translate a recipe's title, description, ingredients, and steps, add
`title_nl`/`title_fr`/`title_de` and `description_nl`/`description_fr`/`description_de`
to the frontmatter, and matching sections in the body — e.g. `## Ingredients (nl)`
and `## Preparation (nl)` alongside the base `## Ingredients`/`## Preparation`.
Any language a recipe doesn't provide falls back to the base version instead of
showing blank — `tags` are never translated, they're the same list in every
language. The local LLM editor writes all four languages automatically when it
saves a recipe; see [`src/lib/recipeFormatPrompt.js`](src/lib/recipeFormatPrompt.js)
for the exact contract. Your language choice is remembered per browser.

## Local development

```bash
npm install
npm run dev
```

## Editing recipes with a local LLM

While `npm run dev` is running, open `/#/editor` (or click "Edit recipes" on
the home page) for a chat-based recipe editor backed by a local LLM. It's
dev-only — the API it talks to is a Vite middleware that never ships to the
deployed GitHub Pages site.

1. Install [Ollama](https://ollama.com) and pull a model, e.g. `ollama pull llama3.1`.
2. Copy `llm.config.example.json` to `llm.config.json` (already gitignored) and
   adjust `baseUrl`/`model` if you're not using Ollama's defaults — e.g. for
   [LM Studio](https://lmstudio.ai) set `baseUrl` to `http://localhost:1234/v1`.
   Any server exposing an OpenAI-compatible `/chat/completions` endpoint works.
3. Run `npm run dev`, open the editor, and chat with it to draft or edit a
   recipe. Either click **Insert reply into draft** to pull its output into
   the draft panel (shown as a rendered preview, not raw markdown — click
   **Edit raw markdown** if you need to tweak the text directly), tweak if
   needed, then **Save recipe** — or just say something like "save it" /
   "add this to my recipes" in the chat and the assistant saves it directly
   (it has a `save_recipe` tool for exactly this). If the draft has
   translations, language tabs (EN/NL/FR/DE) appear above the preview.
4. Mention hashtags in the chat (e.g. "tag this #quick #vegetarian") and
   they're added to the recipe's tags. Click the **gear icon** next to
   "+ New recipe" to view/edit your standing preferences (portion sizes, how
   detailed steps should be, etc.) — this is live, no code changes needed;
   [`src/lib/recipePreferences.js`](src/lib/recipePreferences.js) is only the
   fallback shown before that loads.
5. Click **Auto-tag all recipes** in the recipe list to have the assistant
   review every recipe's content and update its tags, one at a time.
6. A floating **Chat** tab (bottom-right, every page) opens the same
   assistant in an overlay, so you can keep looking at a recipe or the home
   list while talking to it instead of navigating to `/editor`.

## Fridge

Open `/#/fridge` (or click "Fridge" on the home page) for a small pantry
tracker, also dev-only and LLM-backed. Tell it what you have, just bought, or
used up — in English, Dutch, French, or German, any mix — and it keeps a
running ingredient list (stored in `fridge.json`, gitignored). Click **What
can I cook?** and it ranks your saved recipes by how well they match what's
currently on hand, noting what's missing for each.

## Deals and ingredient prices

```bash
cd backend
pip install -r requirements.txt
python -m playwright install chromium
cp .env.template .env   # point LLM_MODEL at whatever you have pulled in Ollama, e.g. qwen3.5:9b
python main.py                                                    # refresh deals data (no LLM needed)
python main.py --categorize                                       # optional: tag deals with a category
python main.py --match-ingredients                                # match recipe ingredients to current deals + supermarktscanner.nl
```

Each writes into `public/data/` (`stores/<slug>.json`, `index.json`,
`ingredient-matches.json`) — commit those and push to update the live site.
Full details in [`backend/README.md`](backend/README.md).

## Deploying to GitHub Pages

See [`docs/deployment.md`](docs/deployment.md) for the full setup and what the
daily scrape/build/deploy workflow does.

## More docs

[`docs/`](docs/) has the deeper technical reference:
- [`docs/architecture.md`](docs/architecture.md) — how the recipe pipeline, LLM editor, fridge, and i18n are built.
- [`docs/deployment.md`](docs/deployment.md) — GitHub Pages setup.
- [`backend/README.md`](backend/README.md) — the deal-scraper backend.
