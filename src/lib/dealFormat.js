const eurFormatter = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
})

/** Formats a euro amount Dutch-style, e.g. 1.99 -> "€ 1,99". Returns null if no price. */
export function formatPrice(price) {
  if (price === null || price === undefined || Number.isNaN(price)) return null
  return eurFormatter.format(price)
}

const unitLabels = {
  gram: 'g',
  gr: 'g',
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  liter: 'L',
  l: 'L',
  stuks: 'st.',
  stuk: 'st.',
}

/** Formats a package size + unit, e.g. (1500, "ml") -> "1500 ml". Returns null if unknown. */
export function formatQuantity(value, unit) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const label = unit ? unitLabels[unit.toLowerCase()] ?? unit : ''
  const num = Number.isInteger(value) ? value.toString() : value.toString().replace('.', ',')
  return label ? `${num} ${label}` : num
}

/** Formats an ISO timestamp as a readable Dutch date/time, e.g. "12 jul 2026, 08:00". */
export function formatDateTime(iso) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('nl-NL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
