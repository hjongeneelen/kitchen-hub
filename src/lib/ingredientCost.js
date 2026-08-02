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
 * Picks which of an ingredient's matches (already sorted cheapest-first) to
 * use, optionally restricted to a set of stores the user actually plans to
 * visit (see lib/preferredStores.js).
 *
 * @param {Array<object>|undefined} matches sorted cheapest-first, each with a `winkel`
 * @param {Set<string>|null|undefined} storeScope store names to restrict to; empty/null/undefined = no restriction
 * @returns {{ match: object, inScope: boolean } | null} inScope is false when
 *          the match returned had to fall back outside the requested scope
 *          because none of the selected stores carried this ingredient at all
 */
export function pickBestMatch(matches, storeScope) {
  if (!matches || matches.length === 0) return null
  if (!storeScope || storeScope.size === 0) return { match: matches[0], inScope: true }

  const inScopeMatch = matches.find((m) => m.winkel && storeScope.has(m.winkel))
  if (inScopeMatch) return { match: inScopeMatch, inScope: true }
  return { match: matches[0], inScope: false }
}

/**
 * @param {string} slug
 * @param {object|null} ingredientMatches the raw useIngredientMatches() result
 * @param {(rawIngredientLine: string) => boolean} [isStaple] skip ingredients
 *        the user always has on hand (see lib/pantry.js) — they don't need
 *        buying, so they shouldn't count toward the estimate.
 * @param {Set<string>|null} [storeScope] restrict matches to these store names (see pickBestMatch)
 * @returns {{ total: number, matchedCount: number, totalCount: number, hasDeal: boolean, outOfScopeCount: number, byStore: Map<string, {count: number, total: number}> } | null}
 *          null if there's no match data at all for this recipe yet (feature never run, or recipe not in it)
 */
export function estimateRecipeCost(slug, ingredientMatches, isStaple, storeScope) {
  const ingredients = ingredientMatches?.recipes?.[slug]?.ingredients
  if (!ingredients || ingredients.length === 0) return null

  let total = 0
  let matchedCount = 0
  let hasDeal = false
  let relevantCount = 0
  let outOfScopeCount = 0
  const byStore = new Map()

  for (const ing of ingredients) {
    if (isStaple && isStaple(ing.raw)) continue
    relevantCount += 1
    const picked = pickBestMatch(ing.matches, storeScope)
    if (!picked || picked.match.actieprijs == null) continue
    const { match: best, inScope } = picked
    matchedCount += 1
    total += best.actieprijs
    if (best.bron === 'eigen-data') hasDeal = true
    if (!inScope) outOfScopeCount += 1

    if (best.winkel) {
      const entry = byStore.get(best.winkel) ?? { count: 0, total: 0 }
      entry.count += 1
      entry.total += best.actieprijs
      byStore.set(best.winkel, entry)
    }
  }

  return { total, matchedCount, totalCount: relevantCount, hasDeal, outOfScopeCount, byStore }
}
