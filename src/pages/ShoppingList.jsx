import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { recipes, localizeRecipe } from '../lib/recipes'
import { useTranslation } from '../hooks/useLocale.jsx'
import { useIngredientMatches } from '../hooks/useIngredientMatches'
import { usePantryStaples } from '../hooks/usePantryStaples.js'
import { usePreferredStores } from '../hooks/usePreferredStores.js'
import { isStapleIngredient } from '../lib/pantry.js'
import { listAvailableStores } from '../lib/preferredStores.js'
import { pickBestMatch } from '../lib/ingredientCost.js'
import { formatPrice } from '../lib/dealFormat'
import DarkModeToggle from '../components/DarkModeToggle.jsx'

/**
 * Builds the merged (store, product) shopping list + grand total for one
 * store-scope choice — called twice (scoped and unscoped) when a scope is
 * active, so the UI can show "cheapest at your shops" next to "cheapest
 * anywhere" for comparison. Pure function, no hooks, so it's cheap to call twice.
 */
function buildShoppingList(selected, ingredientMatches, staples, locale, storeScope) {
  const productMap = new Map()
  const unmatchedLines = []

  for (const slug of selected) {
    const entries = ingredientMatches?.recipes?.[slug]?.ingredients
    if (!entries) continue
    const baseRecipe = recipes.find((r) => r.slug === slug)
    const recipeTitle = baseRecipe ? localizeRecipe(baseRecipe, locale).title : slug

    entries.forEach((ing) => {
      if (isStapleIngredient(ing.raw, staples)) return
      const picked = pickBestMatch(ing.matches, storeScope)
      if (!picked) {
        unmatchedLines.push({ raw: ing.raw, recipeTitle })
        return
      }
      const { match: best, inScope } = picked
      const key = `${best.winkel}|${best.productnaam}`
      if (productMap.has(key)) {
        productMap.get(key).recipeTitles.add(recipeTitle)
      } else {
        productMap.set(key, { ...best, outOfScope: !inScope, recipeTitles: new Set([recipeTitle]) })
      }
    })
  }

  const byStore = new Map()
  for (const item of productMap.values()) {
    const store = item.winkel || 'Onbekende winkel'
    if (!byStore.has(store)) byStore.set(store, [])
    byStore.get(store).push(item)
  }

  const groupsArr = [...byStore.entries()]
    .map(([store, items]) => ({
      store,
      items: items.sort((a, b) => (a.actieprijs ?? 0) - (b.actieprijs ?? 0)),
      subtotal: items.reduce((sum, i) => sum + (i.actieprijs ?? 0), 0),
    }))
    .sort((a, b) => b.subtotal - a.subtotal)

  const grandTotal = groupsArr.reduce((sum, g) => sum + g.subtotal, 0)

  return { groups: groupsArr, unmatched: unmatchedLines, total: grandTotal }
}

const SELECTION_KEY = 'kitchen-hub:shopping-list-recipes'

function loadSelection() {
  try {
    const raw = localStorage.getItem(SELECTION_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch {
    // localStorage unavailable — start with nothing selected
  }
  return new Set()
}

function saveSelection(set) {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify([...set]))
  } catch {
    // localStorage unavailable — selection just won't persist
  }
}

export default function ShoppingList() {
  const { locale } = useTranslation()
  const ingredientMatches = useIngredientMatches()
  const { staples } = usePantryStaples()
  const { stores: preferredStores, storeScope, toggleStore } = usePreferredStores()
  const [selected, setSelected] = useState(loadSelection)
  const [bought, setBought] = useState({})

  const toggleRecipe = (slug) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      saveSelection(next)
      return next
    })
  }

  const availableStores = useMemo(() => listAvailableStores(ingredientMatches), [ingredientMatches])

  // Merge by (store, product) across all selected recipes — if two recipes
  // both need garlic and both matched the same product, that's one thing to
  // buy, not two, so we don't inflate the total or the list. When a store
  // scope is active, also build the unscoped ("cheapest anywhere") totals
  // for comparison — cheap to do twice, it's plain array work, no fetching.
  const { groups, unmatched, total } = useMemo(
    () => buildShoppingList(selected, ingredientMatches, staples, locale, storeScope),
    [selected, ingredientMatches, staples, locale, storeScope]
  )
  const unscopedTotal = useMemo(
    () =>
      storeScope.size > 0
        ? buildShoppingList(selected, ingredientMatches, staples, locale, null).total
        : null,
    [selected, ingredientMatches, staples, locale, storeScope]
  )

  const toggleBought = (key) => setBought((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-16 pt-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-terracotta-500 hover:text-terracotta-600 dark:text-terracotta-300"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Alle recepten
        </Link>
        <DarkModeToggle />
      </header>

      <h1 className="text-2xl font-bold leading-tight text-charcoal-800 dark:text-cream-50">
        Boodschappenlijst
      </h1>
      <p className="mt-2 text-charcoal-500 dark:text-charcoal-200">
        Kies welke recepten je deze week wilt maken — je krijgt één lijst, gegroepeerd per winkel
        met de goedkoopste gevonden prijs, zonder je vaste voorraad.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {recipes.map((r) => {
          const active = selected.has(r.slug)
          return (
            <button
              key={r.slug}
              onClick={() => toggleRecipe(r.slug)}
              className={
                active
                  ? 'tag-pill border-terracotta-500 bg-terracotta-500 text-cream-50'
                  : 'tag-pill border-cream-300 bg-cream-50 text-charcoal-500 hover:border-terracotta-300 hover:text-terracotta-500 dark:border-charcoal-600 dark:bg-charcoal-800 dark:text-cream-200 dark:hover:border-terracotta-400'
              }
            >
              {localizeRecipe(r, locale).title}
            </button>
          )
        })}
      </div>

      {availableStores.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-400 dark:text-charcoal-300">
            Winkels waar je heen gaat
          </h2>
          <p className="mb-2 text-xs text-charcoal-400 dark:text-charcoal-300">
            Niets gekozen = overal de goedkoopste prijs. Kies 1 of meer winkels om te zien wat het
            kost als je alleen daar koopt.
          </p>
          <div className="flex flex-wrap gap-2">
            {availableStores.map((name) => {
              const active = preferredStores.includes(name)
              return (
                <button
                  key={name}
                  onClick={() => toggleStore(name)}
                  className={
                    active
                      ? 'tag-pill border-olive-500 bg-olive-500 text-cream-50'
                      : 'tag-pill border-cream-300 bg-cream-50 text-charcoal-500 hover:border-olive-300 hover:text-olive-600 dark:border-charcoal-600 dark:bg-charcoal-800 dark:text-cream-200 dark:hover:border-olive-400'
                  }
                >
                  {name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {selected.size === 0 ? (
        <p className="mt-10 text-center text-charcoal-300 dark:text-charcoal-400">
          Kies hierboven een of meer recepten.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.store} className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-terracotta-600 dark:text-terracotta-300">{g.store}</h2>
                <span className="text-sm text-charcoal-400 dark:text-charcoal-200">{formatPrice(g.subtotal)}</span>
              </div>
              <ul className="flex flex-col divide-y divide-cream-200 dark:divide-charcoal-700">
                {g.items.map((item) => {
                  const key = `${g.store}|${item.productnaam}`
                  return (
                    <li key={key} className="flex items-center gap-3 py-2">
                      <input
                        type="checkbox"
                        checked={!!bought[key]}
                        onChange={() => toggleBought(key)}
                        className="h-5 w-5 shrink-0 rounded border-charcoal-300 text-terracotta-500 focus:ring-terracotta-400"
                      />
                      <span className={'flex-1 text-charcoal-700 dark:text-cream-100 ' + (bought[key] ? 'checked-line' : '')}>
                        {item.productnaam}
                        <span className="ml-2 text-xs text-charcoal-400 dark:text-charcoal-300">
                          ({[...item.recipeTitles].join(', ')})
                        </span>
                        {item.outOfScope && (
                          <span
                            title="Niet gevonden bij je gekozen winkels — dit is de goedkoopste optie elders"
                            className="ml-2 whitespace-nowrap rounded-full bg-terracotta-100 px-1.5 py-0.5 text-xs font-medium text-terracotta-700 dark:bg-terracotta-900/30 dark:text-terracotta-300"
                          >
                            ⚠ niet bij je winkels
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-sm font-medium text-charcoal-600 dark:text-cream-50">
                        {formatPrice(item.actieprijs) ?? '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}

          {unmatched.length > 0 && (
            <div className="card p-4">
              <h2 className="mb-2 font-semibold text-charcoal-500 dark:text-charcoal-200">
                Geen prijs gevonden ({unmatched.length})
              </h2>
              <ul className="flex flex-col gap-1 text-sm text-charcoal-400 dark:text-charcoal-300">
                {unmatched.map((u, i) => (
                  <li key={i}>
                    {u.raw} <span className="text-xs">({u.recipeTitle})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card flex items-center justify-between p-4">
            <span className="font-semibold text-charcoal-700 dark:text-cream-50">
              {unscopedTotal !== null ? 'Geschat totaal bij je winkels' : 'Geschat totaal'}
            </span>
            <span className="text-right">
              <span className="text-lg font-bold text-terracotta-600 dark:text-terracotta-300">
                {formatPrice(total)}
              </span>
              {unscopedTotal !== null && (
                <span className="block text-xs text-charcoal-400 dark:text-charcoal-300">
                  goedkoopste overal: {formatPrice(unscopedTotal)}
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
