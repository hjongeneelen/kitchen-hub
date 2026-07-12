import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { recipes, getAllTags, localizeRecipe } from '../lib/recipes'
import { useTranslation } from '../hooks/useLocale.jsx'
import { useIngredientMatches } from '../hooks/useIngredientMatches'
import { estimateRecipeCost } from '../lib/ingredientCost'
import RecipeCard from '../components/RecipeCard.jsx'
import SearchBar from '../components/SearchBar.jsx'
import TagFilter from '../components/TagFilter.jsx'
import DarkModeToggle from '../components/DarkModeToggle.jsx'
import LanguageSwitcher from '../components/LanguageSwitcher.jsx'

const SORT_OPTIONS = [
  { value: 'name', label: 'Naam (A-Z)' },
  { value: 'cost-asc', label: 'Geschatte kosten (laag - hoog)' },
  { value: 'prepTime', label: 'Bereidtijd' },
]

export default function Home() {
  const { t, locale } = useTranslation()
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState([])
  const [sort, setSort] = useState('name')
  const allTags = useMemo(getAllTags, [])
  const ingredientMatches = useIngredientMatches()

  const costBySlug = useMemo(() => {
    const map = {}
    for (const recipe of recipes) {
      map[recipe.slug] = estimateRecipeCost(recipe.slug, ingredientMatches)
    }
    return map
  }, [ingredientMatches])

  const toggleTag = (tag) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()

    return recipes.filter((baseRecipe) => {
      const matchesTags = activeTags.every((tag) => baseRecipe.tags.includes(tag))
      if (!matchesTags) return false
      if (!q) return true

      const recipe = localizeRecipe(baseRecipe, locale)
      const haystack = [
        recipe.title,
        recipe.description,
        ...recipe.ingredients,
        ...recipe.steps,
        ...recipe.tags,
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(q)
    })
  }, [query, activeTags, locale])

  const sorted = useMemo(() => {
    const list = [...filtered]
    if (sort === 'cost-asc') {
      list.sort((a, b) => {
        const costA = costBySlug[a.slug]
        const costB = costBySlug[b.slug]
        if (!costA && !costB) return 0
        if (!costA) return 1
        if (!costB) return -1
        return costA.total - costB.total
      })
    } else if (sort === 'prepTime') {
      list.sort((a, b) => (parseInt(a.prepTime) || 9999) - (parseInt(b.prepTime) || 9999))
    } else {
      list.sort((a, b) => localizeRecipe(a, locale).title.localeCompare(localizeRecipe(b, locale).title, 'nl'))
    }
    return list
  }, [filtered, sort, costBySlug, locale])

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-16 pt-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl leading-none" aria-hidden="true">
            🍲
          </span>
          <div>
            <h1 className="text-lg font-bold leading-tight text-terracotta-600 dark:text-terracotta-300">
              Hugo's Kitchen Notebook
            </h1>
            <p className="text-xs text-charcoal-400 dark:text-charcoal-200">
              {t('recipesReady', { count: recipes.length })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/deals"
            title="Aanbiedingen"
            aria-label="Aanbiedingen"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-terracotta-300/50 bg-cream-50 text-terracotta-600 shadow-sm transition hover:bg-cream-200 dark:border-charcoal-500 dark:bg-charcoal-700 dark:text-terracotta-300 dark:hover:bg-charcoal-600"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 1.87-4.712 2.217-7.213a1.125 1.125 0 00-1.115-1.287H5.25M7.5 14.25L5.106 5.272M6 18.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
          </Link>
          {import.meta.env.DEV && (
            <Link
              to="/editor"
              title={t('editRecipes')}
              aria-label={t('editRecipes')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-terracotta-300/50 bg-cream-50 text-terracotta-600 shadow-sm transition hover:bg-cream-200 dark:border-charcoal-500 dark:bg-charcoal-700 dark:text-terracotta-300 dark:hover:bg-charcoal-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 21H6a2.25 2.25 0 01-2.25-2.25V6" />
              </svg>
            </Link>
          )}
          {import.meta.env.DEV && (
            <Link
              to="/fridge"
              title="Fridge"
              aria-label="Fridge"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-terracotta-300/50 bg-cream-50 text-terracotta-600 shadow-sm transition hover:bg-cream-200 dark:border-charcoal-500 dark:bg-charcoal-700 dark:text-terracotta-300 dark:hover:bg-charcoal-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <rect x="5" y="2.5" width="14" height="19" rx="2" />
                <line x1="5" y1="10" x2="19" y2="10" />
                <line x1="8" y1="5" x2="8" y2="7.5" />
                <line x1="8" y1="13" x2="8" y2="15.5" />
              </svg>
            </Link>
          )}
          <LanguageSwitcher />
          <DarkModeToggle />
        </div>
      </header>

      <div className="mb-4">
        <SearchBar value={query} onChange={setQuery} />
      </div>

      <div className="mb-4">
        <TagFilter tags={allTags} activeTags={activeTags} onToggle={toggleTag} />
      </div>

      <div className="mb-6 flex items-center justify-end">
        <label className="flex items-center gap-2 text-sm text-charcoal-500 dark:text-charcoal-200">
          <span>Sorteer:</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border border-cream-300 bg-cream-50 px-2.5 py-1.5 text-sm text-charcoal-700 focus:border-terracotta-400 focus:ring-2 focus:ring-terracotta-400/30 focus:outline-none dark:border-charcoal-600 dark:bg-charcoal-700 dark:text-cream-100"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-3">
        {sorted.map((recipe) => (
          <RecipeCard key={recipe.slug} recipe={recipe} cost={costBySlug[recipe.slug]} />
        ))}

        {sorted.length === 0 && (
          <p className="mt-10 text-center text-charcoal-300 dark:text-charcoal-400">
            {t('noRecipesMatch')}
          </p>
        )}
      </div>
    </div>
  )
}
