import { useState } from 'react'
import { formatPrice, formatQuantity } from '../../lib/dealFormat'

function ImagePlaceholder() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2} className="h-8 w-8 text-charcoal-200 dark:text-charcoal-600">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 4.5h18M3 4.5v15a1.5 1.5 0 001.5 1.5h15a1.5 1.5 0 001.5-1.5v-15M3 4.5A1.5 1.5 0 014.5 3h15A1.5 1.5 0 0121 4.5m-13.5 4.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
    </svg>
  )
}

export default function DealCard({ deal }) {
  const price = formatPrice(deal.actieprijs)
  const quantity = formatQuantity(deal.inhoud_waarde, deal.inhoud_unit)
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = deal.afbeelding_url && !imageFailed

  return (
    <article className="card group flex flex-col justify-between gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-col gap-3">
        <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg bg-cream-50 dark:bg-charcoal-900">
          {showImage ? (
            <img
              src={deal.afbeelding_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-contain"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ImagePlaceholder />
          )}
        </div>

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

        {deal.dealType === 'basisprijs' && (
          <p className="w-fit rounded-lg bg-cream-200 px-2.5 py-1 text-xs font-medium text-charcoal-500 dark:bg-charcoal-700 dark:text-charcoal-200">
            Actuele prijs (geen aanbieding)
          </p>
        )}
      </div>

      <div className="mt-1 flex items-end justify-between gap-2">
        {price ? (
          <span className="text-2xl font-bold tracking-tight text-terracotta-600 dark:text-terracotta-300">
            {price}
          </span>
        ) : (
          <span className="text-sm italic text-charcoal-300 dark:text-charcoal-400">Prijs onbekend</span>
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
