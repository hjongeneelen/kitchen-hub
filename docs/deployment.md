# Deploying to GitHub Pages

1. In [`vite.config.js`](../vite.config.js), set `REPO_NAME` to match your repository
   name, e.g. `'/kitchen-hub/'` (or `'/'` if this is a `<user>.github.io` repo).
2. Push this project to a GitHub repository on the `main` branch.
3. In the repo's **Settings → Pages**, set the source to **GitHub Actions**.
4. Push to `main` — [`.github/workflows/update-and-deploy.yml`](../.github/workflows/update-and-deploy.yml)
   re-scrapes supermarktscanner.nl's deals, builds the site, and publishes it
   automatically on a daily cron (or on push). No paid services, no server.
   The categorization and ingredient-matching steps are local-only (need
   Ollama) and aren't part of this workflow — run them yourself and push the
   result when you want deal categories or the live site's ingredient prices
   refreshed.

The app uses a hash-based router (`/#/recipe/...`), so it works correctly on
GitHub Pages without any extra 404-redirect configuration.

## What the workflow does

`update-and-deploy.yml` has two jobs:

- **`scrape`** (only on the daily cron or a manual `workflow_dispatch`): installs
  the Python backend + Playwright's Chromium, runs `python main.py` to scrape
  supermarktscanner.nl's curated deals page (no LLM needed — see
  [`backend/README.md`](../backend/README.md)), and commits any changed files
  under `public/data/` straight to `main`.
- **`build-and-deploy`** (runs after `scrape`, or directly on a push to `main`
  that touches app source): `npm ci && npm run build`, then publishes `dist/`
  via `actions/upload-pages-artifact` + `actions/deploy-pages`.

The push trigger's `paths` filter excludes `public/data/**` so the `scrape`
job's own commit doesn't recursively re-trigger a build — the `build-and-deploy`
job still runs for that commit because it's chained via `needs: scrape`, not
the push filter.
