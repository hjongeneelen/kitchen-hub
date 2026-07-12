import { useTranslation } from '../hooks/useLocale.jsx'

export default function SearchBar({ value, onChange }) {
  const { t } = useTranslation()

  return (
    <div className="relative">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-charcoal-300"
      >
        <circle cx="11" cy="11" r="7" />
        <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('searchPlaceholder')}
        className="w-full rounded-xl border border-cream-300 bg-cream-50 py-3 pl-10 pr-4 text-charcoal-800 placeholder-charcoal-300 shadow-sm focus:border-terracotta-400 focus:outline-none focus:ring-2 focus:ring-terracotta-200 dark:border-charcoal-600 dark:bg-charcoal-800 dark:text-cream-100 dark:placeholder-charcoal-300 dark:focus:ring-terracotta-700/40"
      />
    </div>
  )
}
