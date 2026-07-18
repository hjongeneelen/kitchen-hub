import { useTranslation } from '../../hooks/useLocale.jsx'

export default function StoreFilterBar({ stores, selected, onToggle, onSelectAll }) {
  const { t } = useTranslation()
  const allSelected = selected.size === 0

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('filterByStore')}>
      <Chip label={t('allStores')} count={null} active={allSelected} onClick={onSelectAll} />
      {stores.map((store) => {
        const hasData = store.deal_count > 0 && store.updated_at !== null
        const active = !allSelected && selected.has(store.slug)
        return (
          <Chip
            key={store.slug}
            label={store.name}
            count={store.deal_count}
            active={active}
            muted={!hasData}
            title={hasData ? undefined : t('notScannedYet')}
            onClick={() => onToggle(store.slug)}
          />
        )
      })}
    </div>
  )
}

function Chip({ label, count, active, muted, title, onClick }) {
  const stateClasses = active
    ? 'border-terracotta-500 bg-terracotta-500 text-cream-50'
    : muted
      ? 'border-cream-300/70 bg-cream-100 text-charcoal-300 hover:border-cream-300 dark:border-charcoal-600 dark:bg-charcoal-800/60 dark:text-charcoal-400'
      : 'border-cream-300 bg-cream-50 text-charcoal-500 hover:border-terracotta-300 hover:text-terracotta-500 dark:border-charcoal-600 dark:bg-charcoal-800 dark:text-cream-200 dark:hover:border-terracotta-400'

  return (
    <button type="button" onClick={onClick} title={title} className={`tag-pill gap-1.5 ${stateClasses}`}>
      <span>{label}</span>
      {count !== null && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
            active
              ? 'bg-white/25 text-cream-50'
              : muted
                ? 'bg-cream-200/70 text-charcoal-300 dark:bg-charcoal-700 dark:text-charcoal-400'
                : 'bg-cream-200 text-charcoal-500 dark:bg-charcoal-700 dark:text-charcoal-200'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}
