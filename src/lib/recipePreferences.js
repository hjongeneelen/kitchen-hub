// Fallback default for Hugo's standing recipe preferences — used by
// EditorPanel.jsx before its /api/preferences fetch resolves, or if the dev
// API can't be reached at all. Once saved at least once via the "Preferences"
// button in the editor, the live source of truth is `preferences.json`
// (gitignored) on disk, not this file — edit this one only to change the
// seed a fresh checkout starts from.
export const RECIPE_PREFERENCES = `Hugo's standing preferences (apply by default; anything he says in the conversation overrides these):

- Portion sizes are generous — Hugo is a big eater. Per portion, unless he asks for less:
  - Rice: 150 g (uncooked weight) per portion.
  - Pasta: 125 g minimum per portion — for example, 4 portions of pasta means 500 g total, not less.
  - For other mains/staples without a listed default, size the portion generously rather than conservatively.
  - Multiply the per-portion amount by the recipe's portions count for the total ingredient quantity.
- Always give a complete Ingredients list and a detailed, numbered Preparation plan. Never shorten steps at the expense of clarity.`
