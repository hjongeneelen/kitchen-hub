import { useTranslation } from '../hooks/useLocale.jsx'

export default function PortionScaler({ portions, onChange, min = 1, max = 24 }) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-3 rounded-xl border border-cream-300 bg-cream-50 px-3 py-2 dark:border-charcoal-600 dark:bg-charcoal-800">
      <button
        onClick={() => onChange(Math.max(min, portions - 1))}
        disabled={portions <= min}
        aria-label={t('decreasePortions')}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-terracotta-500 text-lg font-bold text-cream-50 transition hover:bg-terracotta-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <div className="flex min-w-[5rem] flex-col items-center leading-tight">
        <span className="text-xl font-bold text-charcoal-800 dark:text-cream-50">{portions}</span>
        <span className="text-xs text-charcoal-400 dark:text-charcoal-300">
          {t('portionWord', { count: portions })}
        </span>
      </div>
      <button
        onClick={() => onChange(Math.min(max, portions + 1))}
        disabled={portions >= max}
        aria-label={t('increasePortions')}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-terracotta-500 text-lg font-bold text-cream-50 transition hover:bg-terracotta-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  )
}
