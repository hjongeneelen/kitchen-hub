import { useTranslation } from '../hooks/useLocale.jsx'
import { SUPPORTED_LOCALES } from '../lib/translations'

export default function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation()

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value)}
      aria-label="Language"
      className="h-10 shrink-0 rounded-full border border-terracotta-300/50 bg-cream-50 px-3 text-sm text-terracotta-600 shadow-sm transition hover:bg-cream-200 focus:outline-none focus:ring-2 focus:ring-terracotta-200 dark:border-charcoal-500 dark:bg-charcoal-700 dark:text-terracotta-300 dark:hover:bg-charcoal-600"
    >
      {SUPPORTED_LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  )
}
