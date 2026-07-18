# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies
npm run dev       # start Vite dev server
npm run build     # production build to dist/ (also used by CI/deploy)
npm run preview   # preview the production build locally
```

There is no test suite and no linter configured in this repo.

## Architecture

Hugo's Kitchen Notebook is a 100% static recipe app: Vite + React + Tailwind, no backend, no build-time API calls, no database, merged with a Python-scraped Dutch grocery-deals dashboard (`backend/`). Recipes are just Markdown files, and use metric units only (g/kg/ml/l/cm/°C plus tsp/tbsp) by convention.

Full technical deep-dive — recipe pipeline, dev-only LLM editor + tool-calling, fridge, i18n, deployment — lives in [`docs/architecture.md`](docs/architecture.md); read it before touching any of those subsystems. The scraper backend has its own doc: [`backend/README.md`](backend/README.md) (supermarktscanner.nl pipeline, ingredient matching, automation notes).

Quick orientation:
- **Recipe pipeline**: `.md` files in [`_recipes/`](_recipes/) → [`src/lib/frontmatter.js`](src/lib/frontmatter.js) / [`src/lib/recipes.js`](src/lib/recipes.js) parse and localize them at build time via `import.meta.glob`. No registry file — dropping in a `.md` is enough.
- **Dev-only LLM editor**: [`src/components/EditorPanel.jsx`](src/components/EditorPanel.jsx) + [`vite-plugins/recipeEditorApi.js`](vite-plugins/recipeEditorApi.js), tree-shaken out of production builds via `import.meta.env.DEV`. Talks to any OpenAI-compatible `/chat/completions` server (Ollama, LM Studio) configured in `llm.config.json` (gitignored).
- **Fridge**: [`src/pages/Fridge.jsx`](src/pages/Fridge.jsx), same dev-only LLM pattern, tracks pantry items in `fridge.json` (gitignored).
- **i18n**: hand-rolled, no i18next — [`src/lib/translations.js`](src/lib/translations.js) for UI chrome, `localizeRecipe` in `recipes.js` for recipe content.
- **Deployment**: see [`docs/deployment.md`](docs/deployment.md).
