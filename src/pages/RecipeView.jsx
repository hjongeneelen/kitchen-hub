import { useMemo, useState } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { getRecipeBySlug, localizeRecipe } from '../lib/recipes'
import { scaleIngredientText } from '../lib/scaleText'
import { useTranslation } from '../hooks/useLocale.jsx'
import { useIngredientMatches } from '../hooks/useIngredientMatches'
import { formatPrice } from '../lib/dealFormat'
import PortionScaler from '../components/PortionScaler.jsx'
import CheckableItem from '../components/CheckableItem.jsx'
import DarkModeToggle from '../components/DarkModeToggle.jsx'
import LanguageSwitcher from '../components/LanguageSwitcher.jsx'

export default function RecipeView() {
  const { t, locale } = useTranslation()
  const { slug } = useParams()
  const baseRecipe = getRecipeBySlug(slug)
  const recipe = baseRecipe && localizeRecipe(baseRecipe, locale)

  const [portions, setPortions] = useState(recipe?.portions || 4)
  const [checkedIngredients, setCheckedIngredients] = useState({})
  const [checkedSteps, setCheckedSteps] = useState({})
  const ingredientMatches = useIngredientMatches()

  const ratio = recipe ? portions / recipe.portions : 1

  const scaledIngredients = useMemo(
    () => (recipe ? recipe.ingredients.map((line) => scaleIngredientText(line, ratio)) : []),
    [recipe, ratio]
  )

  // Matched by index, not by text — ingredient-matches.json is keyed off the
  // base (English) "## Ingredients" section, but `recipe` here may be a
  // localized (translated) version with different text in the same order.
  const recipeIngredientMatches = recipe
    ? ingredientMatches?.recipes?.[recipe.slug]?.ingredients
    : null

  if (!recipe) return <Navigate to="/" replace />

  const toggleIngredient = (i) =>
    setCheckedIngredients((prev) => ({ ...prev, [i]: !prev[i] }))
  const toggleStep = (i) => setCheckedSteps((prev) => ({ ...prev, [i]: !prev[i] }))

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 pb-16 pt-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-terracotta-500 hover:text-terracotta-600 dark:text-terracotta-300"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          {t('allRecipes')}
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <DarkModeToggle />
        </div>
      </header>

      <h1 className="text-2xl font-bold leading-tight text-charcoal-800 dark:text-cream-50 sm:text-3xl">
        {recipe.title}
      </h1>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {recipe.prepTime && (
          <span className="inline-flex items-center gap-1 text-olive-600 dark:text-olive-300">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
            </svg>
            {recipe.prepTime}
          </span>
        )}
        {recipe.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-olive-100 px-2 py-0.5 text-xs font-medium text-olive-700 dark:bg-olive-700/30 dark:text-olive-200"
          >
            #{tag}
          </span>
        ))}
      </div>

      {recipe.description && (
        <p className="mt-3 text-charcoal-500 dark:text-charcoal-200">{recipe.description}</p>
      )}

      <div className="mt-5">
        <PortionScaler portions={portions} onChange={setPortions} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-terracotta-600 dark:text-terracotta-300">
            {t('ingredients')}
          </h2>
          <ul className="card divide-y divide-cream-200 p-2 dark:divide-charcoal-700">
            {scaledIngredients.map((text, i) => {
              const bestMatch = recipeIngredientMatches?.[i]?.matches?.[0]
              return (
                <CheckableItem
                  key={i}
                  text={text}
                  checked={!!checkedIngredients[i]}
                  onToggle={() => toggleIngredient(i)}
                  flagged
                  priceBadge={
                    bestMatch && (
                      <span
                        title={`${bestMatch.productnaam} — ${bestMatch.winkel}${
                          bestMatch.bron === 'supermarktscanner.nl' ? ' (supermarktscanner.nl)' : ''
                        }`}
                        className="whitespace-nowrap rounded-full bg-olive-100 px-2 py-0.5 text-xs font-medium text-olive-700 dark:bg-olive-700/30 dark:text-olive-200"
                      >
                        {formatPrice(bestMatch.actieprijs) ?? '—'} · {bestMatch.winkel}
                      </span>
                    )
                  }
                />
              )
            })}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-terracotta-600 dark:text-terracotta-300">
            {t('preparation')}
          </h2>
          <ol className="card flex flex-col gap-1 divide-y divide-cream-200 p-2 dark:divide-charcoal-700">
            {recipe.steps.map((text, i) => (
              <CheckableItem
                key={i}
                text={text}
                checked={!!checkedSteps[i]}
                onToggle={() => toggleStep(i)}
              />
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
