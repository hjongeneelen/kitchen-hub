import { formatPrice, formatQuantity } from '../../lib/dealFormat'
import { useTranslation } from '../../hooks/useLocale.jsx'

export default function DealCard({ deal }) {
  const { t } = useTranslation()
  const price = formatPrice(deal.actieprijs)
  const quantity = formatQuantity(deal.inhoud_waarde, deal.inhoud_unit)

  return (
    <article className="card group flex flex-col justify-between gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-cream-200 px-2.5 py-1 text-xs font-semibold text-charcoal-500 dark:bg-charcoal-700 dark:text-charcoal-200">
            <span className="h-1.5 w-1.5 rounded-full bg-olive-500" aria-hidden="true" />
            {deal.storeName}
          </span>
          {quantity && (
            <span className="shrink-0 text-xs font-medium text-charcoal-300 dark:text-charcoal-400">
              {quantity}
            </span>
          )}
        </div>

        {deal.categorie && (
          <span className="w-fit rounded-full bg-olive-100 px-2 py-0.5 text-xs font-medium text-olive-700 dark:bg-olive-700/30 dark:text-olive-200">
            {deal.categorie}
          </span>
        )}

        <h3 className="line-clamp-2 text-base font-semibold leading-snug text-charcoal-800 dark:text-cream-50">
          {deal.productnaam}
        </h3>

        {deal.korting_tekst && (
          <p className="w-fit rounded-lg bg-terracotta-50 px-2.5 py-1 text-sm font-medium text-terracotta-600 dark:bg-terracotta-900/30 dark:text-terracotta-300">
            {deal.korting_tekst}
          </p>
        )}
      </div>

      <div className="mt-1 flex items-end justify-between gap-2">
        {price ? (
          <span className="text-2xl font-bold tracking-tight text-terracotta-600 dark:text-terracotta-300">
            {price}
          </span>
        ) : (
          <span className="text-sm italic text-charcoal-300 dark:text-charcoal-400">{t('priceUnknown')}</span>
        )}
        {deal.geldig_tekst && (
          <span className="shrink-0 text-right text-xs text-charcoal-300 dark:text-charcoal-400">
            {deal.geldig_tekst}
          </span>
        )}
      </div>
    </article>
  )
}
