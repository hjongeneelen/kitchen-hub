import { useEffect, useState } from 'react'

const dataUrl = (path) => `${import.meta.env.BASE_URL}data/${path}`

/**
 * Fetches public/data/ingredient-matches.json (precomputed by
 * `python backend/main.py --match-ingredients`, needs Ollama — never called
 * live from the deployed site). Missing file (feature never run yet) is
 * treated as "no matches available", not an error.
 */
export function useIngredientMatches() {
  const [data, setData] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(dataUrl('ingredient-matches.json'))
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return data
}
