/**
 * Turns ingredient-matches.json into a per-recipe cost estimate.
 *
 * This is a "cost of buying one of each matched product" estimate, NOT a
 * precise recipe cost — matching "3-4 cloves garlic" to a package of garlic
 * doesn't tell us the price of just those 3-4 cloves, only the price of the
 * package you'd actually buy. That's still a genuinely useful number (roughly
 * what you'd spend), just not one to treat as exact down to the cent.
 */

/**
 * @param {string} slug
 * @param {object|null} ingredientMatches the raw useIngredientMatches() result
 * @returns {{ total: number, matchedCount: number, totalCount: number, hasDeal: boolean } | null}
 *          null if there's no match data at all for this recipe yet (feature never run, or recipe not in it)
 */
export function estimateRecipeCost(slug, ingredientMatches) {
  const ingredients = ingredientMatches?.recipes?.[slug]?.ingredients
  if (!ingredients || ingredients.length === 0) return null

  let total = 0
  let matchedCount = 0
  let hasDeal = false

  for (const ing of ingredients) {
    const best = ing.matches?.[0]
    if (!best || best.actieprijs == null) continue
    matchedCount += 1
    total += best.actieprijs
    if (best.bron === 'eigen-data') hasDeal = true
  }

  return { total, matchedCount, totalCount: ingredients.length, hasDeal }
}
