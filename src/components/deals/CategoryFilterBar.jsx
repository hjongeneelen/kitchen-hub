import { useTranslation } from '../../hooks/useLocale.jsx'

export default function CategoryFilterBar({
  categories,
  selected,
  onToggle,
  onSelectAll,
  uncategorizedCount,
}) {
  const { t } = useTranslation()
  const allSelected = selected.size === 0

  if (categories.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('filterByCategory')}>
      <Chip label={t('allCategories')} count={null} active={allSelected} onClick={onSelectAll} />
      {categories.map((cat) => (
        <Chip
          key={cat.name}
          label={cat.name}
          count={cat.count}
          active={!allSelected && selected.has(cat.name)}
          onClick={() => onToggle(cat.name)}
        />
      ))}
      {uncategorizedCount > 0 && (
        <span
          className="tag-pill border-dashed border-cream-300 bg-transparent text-charcoal-300 dark:border-charcoal-600 dark:text-charcoal-400"
          title={t('categoryClassifierNote')}
        >
          {t('uncategorizedCount', { count: uncategorizedCount })}
        </span>
      )}
    </div>
  )
}

function Chip({ label, count, active, onClick }) {
  const stateClasses = active
    ? 'border-olive-500 bg-olive-500 text-cream-50'
    : 'border-cream-300 bg-cream-50 text-charcoal-500 hover:border-olive-300 hover:text-olive-600 dark:border-charcoal-600 dark:bg-charcoal-800 dark:text-cream-200 dark:hover:border-olive-400'

  return (
    <button type="button" onClick={onClick} className={`tag-pill gap-1.5 ${stateClasses}`}>
      <span>{label}</span>
      {count !== null && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
            active
              ? 'bg-white/25 text-cream-50'
              : 'bg-cream-200 text-charcoal-500 dark:bg-charcoal-700 dark:text-charcoal-200'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}
