// UI chrome translations only — recipe content (title, ingredients, steps)
// is never translated and stays exactly as written in the .md file.
export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
]

const dictionaries = {
  en: {
    recipesReady_one: '{count} recipe ready to cook',
    recipesReady_other: '{count} recipes ready to cook',
    editRecipes: 'Edit recipes',
    noRecipesMatch: 'No recipes match your search. Try a different term or tag.',
    searchPlaceholder: 'Search recipes, ingredients...',
    portionsCount_one: '{count} portion',
    portionsCount_other: '{count} portions',
    portionWord_one: 'portion',
    portionWord_other: 'portions',
    allRecipes: 'All recipes',
    ingredients: 'Ingredients',
    preparation: 'Preparation',
    decreasePortions: 'Decrease portions',
    increasePortions: 'Increase portions',
    toggleDarkMode: 'Toggle dark mode',
    contains: 'Contains: {flags}',
  },
  nl: {
    recipesReady_one: '{count} recept klaar om te koken',
    recipesReady_other: '{count} recepten klaar om te koken',
    editRecipes: 'Recepten bewerken',
    noRecipesMatch: 'Geen recepten gevonden. Probeer een andere zoekterm of tag.',
    searchPlaceholder: 'Zoek recepten, ingrediënten...',
    portionsCount_one: '{count} portie',
    portionsCount_other: '{count} porties',
    portionWord_one: 'portie',
    portionWord_other: 'porties',
    allRecipes: 'Alle recepten',
    ingredients: 'Ingrediënten',
    preparation: 'Bereiding',
    decreasePortions: 'Minder porties',
    increasePortions: 'Meer porties',
    toggleDarkMode: 'Donkere modus wisselen',
    contains: 'Bevat: {flags}',
  },
  fr: {
    recipesReady_one: '{count} recette prête à cuisiner',
    recipesReady_other: '{count} recettes prêtes à cuisiner',
    editRecipes: 'Modifier les recettes',
    noRecipesMatch: 'Aucune recette ne correspond à votre recherche. Essayez un autre terme ou tag.',
    searchPlaceholder: 'Rechercher des recettes, ingrédients...',
    portionsCount_one: '{count} portion',
    portionsCount_other: '{count} portions',
    portionWord_one: 'portion',
    portionWord_other: 'portions',
    allRecipes: 'Toutes les recettes',
    ingredients: 'Ingrédients',
    preparation: 'Préparation',
    decreasePortions: 'Moins de portions',
    increasePortions: 'Plus de portions',
    toggleDarkMode: 'Basculer le mode sombre',
    contains: 'Contient : {flags}',
  },
  de: {
    recipesReady_one: '{count} Rezept fertig zum Kochen',
    recipesReady_other: '{count} Rezepte fertig zum Kochen',
    editRecipes: 'Rezepte bearbeiten',
    noRecipesMatch: 'Keine Rezepte gefunden. Versuche einen anderen Suchbegriff oder Tag.',
    searchPlaceholder: 'Rezepte, Zutaten suchen...',
    portionsCount_one: '{count} Portion',
    portionsCount_other: '{count} Portionen',
    portionWord_one: 'Portion',
    portionWord_other: 'Portionen',
    allRecipes: 'Alle Rezepte',
    ingredients: 'Zutaten',
    preparation: 'Zubereitung',
    decreasePortions: 'Weniger Portionen',
    increasePortions: 'Mehr Portionen',
    toggleDarkMode: 'Dunkelmodus umschalten',
    contains: 'Enthält: {flags}',
  },
}

export function translate(locale, key, params = {}) {
  const dict = dictionaries[locale] || dictionaries.en
  const lookupKey = params.count !== undefined ? `${key}_${params.count === 1 ? 'one' : 'other'}` : key
  const template = dict[lookupKey] ?? dictionaries.en[lookupKey] ?? key

  return template.replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? params[name] : match))
}
