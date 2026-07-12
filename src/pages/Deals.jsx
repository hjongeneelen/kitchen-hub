import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDeals } from '../hooks/useDeals.js'
import { formatDateTime } from '../lib/dealFormat'
import DarkModeToggle from '../components/DarkModeToggle.jsx'
import StoreFilterBar from '../components/deals/StoreFilterBar.jsx'
import CategoryFilterBar from '../components/deals/CategoryFilterBar.jsx'
import SearchAndSort from '../components/deals/SearchAndSort.jsx'
import DealGrid from '../components/deals/DealGrid.jsx'

export default function Deals() {
  const { loading, error, generatedAt, stores, deals } = useDeals()

  const [selectedStores, setSelectedStores] = useState(new Set())
  const [selectedCategories, setSelectedCategories] = useState(new Set())
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('price-asc')

  const toggleStore = (slug) => {
    setSelectedStores((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) {
        next.delete(slug)
      } else {
        next.add(slug)
      }
      return next
    })
  }

  const toggleCategory = (category) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const resetFilters = () => {
    setSelectedStores(new Set())
    setSelectedCategories(new Set())
    setQuery('')
  }

  const categoryEntries = useMemo(() => {
    const counts = new Map()
    for (const deal of deals) {
      if (deal.categorie) {
        counts.set(deal.categorie, (counts.get(deal.categorie) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [deals])

  const uncategorizedCount = useMemo(() => deals.filter((d) => !d.categorie).length, [deals])

  const visibleDeals = useMemo(() => {
    const q = query.trim().toLowerCase()

    const filtered = deals.filter((deal) => {
      const storeMatches = selectedStores.size === 0 || selectedStores.has(deal.storeSlug)
      const categoryMatches =
        selectedCategories.size === 0 ||
        (deal.categorie !== null && selectedCategories.has(deal.categorie))
      const queryMatches = q === '' || deal.productnaam.toLowerCase().includes(q)
      return storeMatches && categoryMatches && queryMatches
    })

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'price-asc': {
          if (a.actieprijs === null) return 1
          if (b.actieprijs === null) return -1
          return a.actieprijs - b.actieprijs
        }
        case 'price-desc': {
          if (a.actieprijs === null) return 1
          if (b.actieprijs === null) return -1
          return b.actieprijs - a.actieprijs
        }
        case 'store-asc':
          return (
            a.storeName.localeCompare(b.storeName, 'nl') ||
            a.productnaam.localeCompare(b.productnaam, 'nl')
          )
        default:
          return 0
      }
    })
  }, [deals, selectedStores, selectedCategories, query, sort])

  const scrapedStoreCount = stores.filter((s) => s.deal_count > 0 && s.updated_at !== null).length
  const updated = formatDateTime(generatedAt)

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-16 pt-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl leading-none" aria-hidden="true">
            🛒
          </span>
          <div>
            <h1 className="text-lg font-bold leading-tight text-terracotta-600 dark:text-terracotta-300">
              Aanbiedingen
            </h1>
            <p className="text-xs text-charcoal-400 dark:text-charcoal-200">
              {deals.length.toLocaleString('nl-NL')} aanbiedingen &middot; {scrapedStoreCount} van{' '}
              {stores.length} winkels gescand
              {updated ? ` · bijgewerkt ${updated}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/"
            title="Terug naar recepten"
            aria-label="Terug naar recepten"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-terracotta-300/50 bg-cream-50 text-terracotta-600 shadow-sm transition hover:bg-cream-200 dark:border-charcoal-500 dark:bg-charcoal-700 dark:text-terracotta-300 dark:hover:bg-charcoal-600"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
            </svg>
          </Link>
          <DarkModeToggle />
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-terracotta-300/70 bg-terracotta-50 px-4 py-3 text-sm text-terracotta-700 dark:border-terracotta-700/50 dark:bg-terracotta-900/20 dark:text-terracotta-300">
          Er ging iets mis bij het laden van de data: {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-2xl border border-cream-300/70 bg-cream-200/60 dark:border-charcoal-600 dark:bg-charcoal-700/60"
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-charcoal-400 dark:text-charcoal-300">
              Winkels
            </h2>
            <StoreFilterBar
              stores={stores}
              selected={selectedStores}
              onToggle={toggleStore}
              onSelectAll={() => setSelectedStores(new Set())}
            />
          </section>

          {categoryEntries.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-charcoal-400 dark:text-charcoal-300">
                Categorieën
              </h2>
              <CategoryFilterBar
                categories={categoryEntries}
                selected={selectedCategories}
                onToggle={toggleCategory}
                onSelectAll={() => setSelectedCategories(new Set())}
                uncategorizedCount={uncategorizedCount}
              />
            </section>
          )}

          <section className="sticky top-0 z-10 -mx-4 border-b border-cream-300/70 bg-cream-100/90 px-4 py-3 backdrop-blur-sm dark:border-charcoal-600 dark:bg-charcoal-900/90 sm:mx-0 sm:rounded-xl sm:border sm:px-4">
            <SearchAndSort
              query={query}
              onQueryChange={setQuery}
              sort={sort}
              onSortChange={setSort}
              resultCount={visibleDeals.length}
            />
          </section>

          <section>
            <DealGrid deals={visibleDeals} onResetFilters={resetFilters} />
          </section>
        </div>
      )}

      <footer className="mt-10 text-center text-xs text-charcoal-300 dark:text-charcoal-500">
        Gegevens worden periodiek automatisch of handmatig bijgewerkt per winkel. Prijzen kunnen
        afwijken van de prijs in de winkel zelf.
      </footer>
    </div>
  )
}
