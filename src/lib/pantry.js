const STORAGE_KEY = 'kitchen-hub:pantry-staples'

// English, since ingredient-matches.json (and estimateRecipeCost's matching)
// works off the recipe's base English "## Ingredients" text regardless of
// which language is currently displayed — see usePantryStaples.js.
const DEFAULT_STAPLES = ['onion', 'garlic', 'oil', 'salt', 'pepper', 'butter']

export function loadStaples() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    // localStorage unavailable or corrupt value — fall through to defaults
  }
  return DEFAULT_STAPLES
}

export function saveStaples(staples) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(staples))
  } catch {
    // localStorage unavailable (private browsing, quota) — staples just won't persist
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Case-insensitive whole-word match (allowing a simple plural "s"/"es"): does
 * this ingredient line mention a staple? Word-boundary matching, not a plain
 * substring check — "oil" must not match inside "boiling", nor "egg" inside
 * "eggplant" — while still matching "onion" against "onions".
 */
export function isStapleIngredient(ingredientLine, staples) {
  if (!ingredientLine) return false
  return staples.some((s) => {
    if (!s) return false
    const re = new RegExp(`\\b${escapeRegExp(s.toLowerCase())}(?:s|es)?\\b`, 'i')
    return re.test(ingredientLine)
  })
}
