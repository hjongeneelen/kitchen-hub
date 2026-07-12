export default function SearchAndSort({ query, onQueryChange, sort, onSortChange, resultCount }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-sm">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-4.35-4.35M17 10.5A6.5 6.5 0 114 10.5a6.5 6.5 0 0113 0z"
          />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Zoek op productnaam..."
          className="w-full rounded-xl border border-cream-300 bg-cream-50 py-2.5 pl-9 pr-3 text-sm text-charcoal-800 placeholder-charcoal-300 shadow-sm focus:border-terracotta-400 focus:outline-none focus:ring-2 focus:ring-terracotta-200 dark:border-charcoal-600 dark:bg-charcoal-800 dark:text-cream-100 dark:placeholder-charcoal-300 dark:focus:ring-terracotta-700/40"
          aria-label="Zoek op productnaam"
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-charcoal-400 tabular-nums dark:text-charcoal-200">
          {resultCount.toLocaleString('nl-NL')} {resultCount === 1 ? 'resultaat' : 'resultaten'}
        </span>
        <label className="flex items-center gap-2 text-sm text-charcoal-500 dark:text-charcoal-200">
          <span className="hidden sm:inline">Sorteer:</span>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value)}
            className="rounded-xl border border-cream-300 bg-cream-50 px-2.5 py-2 text-sm text-charcoal-700 focus:border-terracotta-400 focus:outline-none focus:ring-2 focus:ring-terracotta-200 dark:border-charcoal-600 dark:bg-charcoal-800 dark:text-cream-100"
          >
            <option value="price-asc">Prijs (laag - hoog)</option>
            <option value="price-desc">Prijs (hoog - laag)</option>
            <option value="store-asc">Winkelnaam (A-Z)</option>
          </select>
        </label>
      </div>
    </div>
  )
}
