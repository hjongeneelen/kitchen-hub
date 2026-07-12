import { findFlags } from '../lib/safetyFlags'
import { useTranslation } from '../hooks/useLocale.jsx'

export default function CheckableItem({ text, checked, onToggle, flagged = false, priceBadge = null }) {
  const { t } = useTranslation()
  const flags = flagged ? findFlags(text) : []

  return (
    <li>
      <label
        className={
          'flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition ' +
          (flags.length
            ? 'bg-terracotta-50 ring-1 ring-terracotta-200 dark:bg-terracotta-900/20 dark:ring-terracotta-700/50'
            : 'hover:bg-cream-100 dark:hover:bg-charcoal-700')
        }
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-charcoal-300 text-terracotta-500 focus:ring-terracotta-400"
        />
        <span className={'text-charcoal-700 dark:text-cream-100 ' + (checked ? 'checked-line' : '')}>
          {text}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {priceBadge}
          {flags.length > 0 && (
            <span
              title={t('contains', { flags: flags.join(', ') })}
              className="text-terracotta-500 dark:text-terracotta-300"
            >
              ⚠️
            </span>
          )}
        </span>
      </label>
    </li>
  )
}
