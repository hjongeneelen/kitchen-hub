// Detects quantities in ingredient text (mixed numbers, fractions, decimals,
// unicode vulgar fractions, and ranges like "2-3") and scales them by a ratio.

const VULGAR_FRACTIONS = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

const NICE_FRACTIONS = [
  { value: 1 / 8, glyph: '⅛' },
  { value: 1 / 4, glyph: '¼' },
  { value: 1 / 3, glyph: '⅓' },
  { value: 3 / 8, glyph: '⅜' },
  { value: 1 / 2, glyph: '½' },
  { value: 5 / 8, glyph: '⅝' },
  { value: 2 / 3, glyph: '⅔' },
  { value: 3 / 4, glyph: '¾' },
  { value: 7 / 8, glyph: '⅞' },
]

const VULGAR_CLASS = Object.keys(VULGAR_FRACTIONS).join('')

// Matches, in priority order: "1 1/2", "1/2", a lone vulgar fraction,
// decimals, plain integers — each optionally followed by "-N" for a range.
const NUMBER_TOKEN = new RegExp(
  `(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|[${VULGAR_CLASS}]|\\d+\\.\\d+|\\d+)(\\s*-\\s*(\\d+\\.\\d+|\\d+))?`,
  'g'
)

function parseToken(token) {
  if (VULGAR_FRACTIONS[token] !== undefined) return VULGAR_FRACTIONS[token]

  const mixed = token.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])

  const frac = token.match(/^(\d+)\/(\d+)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])

  return Number(token)
}

export function formatNumber(value) {
  if (!Number.isFinite(value) || value <= 0) return '0'

  const whole = Math.floor(value)
  const remainder = value - whole

  if (remainder < 0.02) {
    return String(whole || value.toFixed(0))
  }

  const nearest = NICE_FRACTIONS.reduce((best, f) =>
    Math.abs(f.value - remainder) < Math.abs(best.value - remainder) ? f : best
  )

  if (Math.abs(nearest.value - remainder) < 0.05) {
    return whole > 0 ? `${whole}${nearest.glyph}` : nearest.glyph
  }

  // Fall back to a clean decimal (max 2 places, no trailing zeros)
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}

export function scaleIngredientText(text, ratio) {
  if (!text || ratio === 1) return text

  return text.replace(NUMBER_TOKEN, (fullMatch, first, rangeSuffix, rangeEnd) => {
    const start = parseToken(first) * ratio

    if (rangeEnd) {
      const end = Number(rangeEnd) * ratio
      return `${formatNumber(start)}-${formatNumber(end)}`
    }

    return formatNumber(start)
  })
}
