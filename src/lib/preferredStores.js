const STORAGE_KEY = 'kitchen-hub:preferred-stores'

export function loadPreferredStores() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    // localStorage unavailable or corrupt value — fall through to "no restriction"
  }
  return []
}

export function savePreferredStores(stores) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stores))
  } catch {
    // localStorage unavailable (private browsing, quota) — selection just won't persist
  }
}

/**
 * Every distinct store name ("winkel") that appears anywhere across every
 * recipe's ingredient matches — own-data deals, the supermarktscanner.nl
 * fallback, and (once scraped) the Hoogvliet/Poiesz/essentials sources —
 * sorted alphabetically, for populating a store-scope picker.
 *
 * @param {object|null} ingredientMatches the raw useIngredientMatches() result
 * @returns {string[]}
 */
export function listAvailableStores(ingredientMatches) {
  const names = new Set()
  for (const recipe of Object.values(ingredientMatches?.recipes ?? {})) {
    for (const ing of recipe.ingredients ?? []) {
      for (const match of ing.matches ?? []) {
        if (match.winkel) names.add(match.winkel)
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'nl'))
}
