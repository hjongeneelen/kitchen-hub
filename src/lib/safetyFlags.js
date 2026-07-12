// Ingredients to flag so they're easy to spot (and swap out) while scanning
// a recipe — edit this list to match whatever you personally avoid.
export const FLAGGED_INGREDIENTS = [
  { match: /aubergine|eggplant/i, label: 'aubergine' },
  { match: /champignons?|mushrooms?|paddenstoel\w*|pilz\w*/i, label: 'mushroom' },
  { match: /ricotta/i, label: 'ricotta' },
  { match: /feta/i, label: 'feta' },
  { match: /olijven|olives?/i, label: 'olive' },
]

export function findFlags(text) {
  if (!text) return []
  return FLAGGED_INGREDIENTS.filter((f) => f.match.test(text)).map((f) => f.label)
}

export function containsFlaggedIngredient(text) {
  return findFlags(text).length > 0
}
