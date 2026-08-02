import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { getRecipeBySlug, localizeRecipe } from '../lib/recipes'
import { scaleIngredientText } from '../lib/scaleText'
import { useTranslation } from '../hooks/useLocale.jsx'
import { useIngredientMatches } from '../hooks/useIngredientMatches'
import { estimateRecipeCost, pickBestMatch } from '../lib/ingredientCost'
import { usePantryStaples } from '../hooks/usePantryStaples.js'
import { usePreferredStores } from '../hooks/usePreferredStores.js'
import { isStapleIngredient } from '../lib/pantry.js'
import { loadProgress, saveProgress } from '../lib/recipeProgress.js'
import { formatPrice } from '../lib/dealFormat'
import { translateTag } from '../lib/translations'
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
  const { staples } = usePantryStaples()
  const { storeScope } = usePreferredStores()

  const ratio = recipe ? portions / recipe.portions : 1

  const scaledIngredients = useMemo(
    () => (recipe ? recipe.ingredients.map((line) => scaleIngredientText(line, ratio)) : []),
    [recipe, ratio]
  )

  // Matched against the base (English) ingredient text regardless of display
  // language — always available even before the price-matching feature has
  // ever run, unlike matching against ingredient-matches.json.
  const isStapleAt = (i) => isStapleIngredient(baseRecipe?.ingredients?.[i], staples)

  // On first-ever visit to a recipe, pre-check ingredients the user always
  // has on hand. On every later visit, restore whatever was left checked
  // last time instead — a manually-unchecked staple (ran out) or manually-
  // checked non-staple shouldn't be silently overwritten by re-deriving from
  // the staples list every time.
  useEffect(() => {
    if (!baseRecipe) return
    const persisted = loadProgress(baseRecipe.slug)
    if (persisted) {
      setCheckedIngredients(persisted.ingredients || {})
      setCheckedSteps(persisted.steps || {})
      return
    }
    const initial = {}
    baseRecipe.ingredients.forEach((line, i) => {
      if (isStapleIngredient(line, staples)) initial[i] = true
    })
    setCheckedIngredients(initial)
    setCheckedSteps({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRecipe])

  // Persist on every change so progress survives a reload/navigating away.
  useEffect(() => {
    if (!baseRecipe) return
    saveProgress(baseRecipe.slug, { ingredients: checkedIngredients, steps: checkedSteps })
  }, [baseRecipe, checkedIngredients, checkedSteps])

  // Matched by index, not by text — ingredient-matches.json is keyed off the
  // base (English) "## Ingredients" section, but `recipe` here may be a
  // localized (translated) version with different text in the same order.
  const recipeIngredientMatches = recipe
    ? ingredientMatches?.recipes?.[recipe.slug]?.ingredients
    : null
  const cost = recipe
    ? estimateRecipeCost(recipe.slug, ingredientMatches, (line) => isStapleIngredient(line, staples), storeScope)
    : null

  if (!recipe) return <Navigate to="/" replace />

  const toggleIngredient = (i) =>
    setCheckedIngredients((prev) => ({ ...prev, [i]: !prev[i] }))
  const toggleStep = (i) => setCheckedSteps((prev) => ({ ...prev, [i]: !prev[i] }))

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 pb-16 pt-6">
      <header className="mb-4 flex items-center justify-between gap-4 print:hidden">
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
            #{translateTag(tag, locale)}
          </span>
        ))}
      </div>

      {recipe.description && (
        <p className="mt-3 text-charcoal-500 dark:text-charcoal-200">{recipe.description}</p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <PortionScaler portions={portions} onChange={setPortions} />
        <button
          onClick={() => window.print()}
          title="Recept printen"
          className="print:hidden inline-flex items-center gap-1.5 rounded-full border border-terracotta-300/50 bg-cream-50 px-3 py-1.5 text-sm font-medium text-terracotta-600 shadow-sm transition hover:bg-cream-200 dark:border-charcoal-500 dark:bg-charcoal-700 dark:text-terracotta-300 dark:hover:bg-charcoal-600"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
          </svg>
          Printen
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-terracotta-600 dark:text-terracotta-300">
              {t('ingredients')}
            </h2>
            <button
              onClick={() => {
                const initial = {}
                baseRecipe.ingredients.forEach((line, i) => {
                  if (isStapleIngredient(line, staples)) initial[i] = true
                })
                setCheckedIngredients(initial)
              }}
              title="Vink alles opnieuw uit, behalve je vaste voorraad"
              className="print:hidden text-xs font-medium text-charcoal-400 hover:text-terracotta-500 dark:text-charcoal-300 dark:hover:text-terracotta-300"
            >
              Lijst resetten
            </button>
          </div>
          {storeScope.size > 0 && (
            <p className="print:hidden mb-2 text-xs text-charcoal-400 dark:text-charcoal-300">
              Prijzen voor jouw winkels ({[...storeScope].join(', ')}) —{' '}
              <Link to="/shopping-list" className="underline hover:text-terracotta-500">
                wijzigen
              </Link>
            </p>
          )}
          <ul className="card divide-y divide-cream-200 p-2 dark:divide-charcoal-700">
            {scaledIngredients.map((text, i) => {
              const matches = recipeIngredientMatches?.[i]?.matches
              const picked = pickBestMatch(matches, storeScope)
              const bestMatch = picked?.match
              const isDeal = bestMatch?.bron === 'eigen-data'
              const isStaple = isStapleAt(i)
              const alternatives = (matches ?? []).filter((m) => m !== bestMatch).slice(0, 2)

              const badgeTitle = !bestMatch
                ? undefined
                : !picked.inScope
                  ? `Niet gevonden bij je gekozen winkels — goedkoopste alternatief: ${bestMatch.productnaam} — ${bestMatch.winkel}`
                  : isDeal
                    ? `In de aanbieding: ${bestMatch.productnaam} — ${bestMatch.winkel}`
                    : `Goedkoopste huidige prijs (geen aanbieding): ${bestMatch.productnaam} — ${bestMatch.winkel}, via supermarktscanner.nl`
              const badgeClass =
                'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ' +
                (isDeal
                  ? 'bg-terracotta-100 text-terracotta-700 dark:bg-terracotta-900/30 dark:text-terracotta-200'
                  : 'bg-cream-200 text-charcoal-600 dark:bg-charcoal-600 dark:text-charcoal-100')
              const badgeContent = (
                <>
                  {isDeal && '🏷️ '}
                  {formatPrice(bestMatch?.actieprijs) ?? '—'} · {bestMatch?.winkel}
                  {picked && !picked.inScope && ' ⚠'}
                </>
              )

              return (
                <CheckableItem
                  key={i}
                  text={text}
                  checked={!!checkedIngredients[i]}
                  onToggle={() => toggleIngredient(i)}
                  flagged
                  priceBadge={
                    isStaple ? (
                      <span
                        title="Staat op je vaste-voorraadlijst — telt niet mee in de kostenschatting"
                        className="whitespace-nowrap rounded-full bg-cream-200 px-2 py-0.5 text-xs font-medium text-charcoal-500 dark:bg-charcoal-600 dark:text-charcoal-200"
                      >
                        🏠 heb ik
                      </span>
                    ) : (
                      bestMatch &&
                      (alternatives.length > 0 ? (
                        <details className="group relative">
                          <summary
                            title={badgeTitle}
                            className={'list-none cursor-pointer [&::-webkit-details-marker]:hidden ' + badgeClass}
                          >
                            {badgeContent}
                            <span className="ml-1 text-charcoal-400 group-open:hidden">▾</span>
                          </summary>
                          <div className="absolute right-0 z-10 mt-1 flex flex-col gap-1 whitespace-nowrap rounded-lg border border-cream-300 bg-cream-50 p-2 text-xs shadow-md dark:border-charcoal-600 dark:bg-charcoal-800">
                            {alternatives.map((m, j) => (
                              <span key={j} className="text-charcoal-600 dark:text-cream-100">
                                {formatPrice(m.actieprijs) ?? '—'} · {m.winkel}
                              </span>
                            ))}
                          </div>
                        </details>
                      ) : (
                        <span title={badgeTitle} className={badgeClass}>
                          {badgeContent}
                        </span>
                      ))
                    )
                  }
                />
              )
            })}
          </ul>
          {cost && cost.matchedCount > 0 && (
            <p className="mt-2 px-2 text-sm text-charcoal-400 dark:text-charcoal-200">
              Geschatte boodschappenkosten:{' '}
              <span className="font-semibold text-charcoal-700 dark:text-cream-50">
                {formatPrice(cost.total)}
              </span>{' '}
              (op basis van {cost.matchedCount}/{cost.totalCount} ingrediënten — prijs van hele
              verpakkingen, niet van de exacte hoeveelheid)
              {storeScope.size > 0 && cost.outOfScopeCount > 0 && (
                <>
                  {' '}
                  — {cost.outOfScopeCount} niet gevonden bij je gekozen winkels, daarvoor toont dit
                  de goedkoopste prijs elders
                </>
              )}
            </p>
          )}
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
