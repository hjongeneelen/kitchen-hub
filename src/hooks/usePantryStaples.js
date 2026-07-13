import { useCallback, useEffect, useState } from 'react'
import { loadStaples, saveStaples } from '../lib/pantry'

/**
 * Persistent (localStorage) list of ingredients the user always has on hand
 * (onion, garlic, oil, ...) — matched by case-insensitive substring against
 * each recipe's base English ingredient text (see lib/pantry.js), regardless
 * of which display language is active, so add staples in English for the
 * match to work everywhere.
 */
export function usePantryStaples() {
  const [staples, setStaples] = useState(loadStaples)

  useEffect(() => {
    saveStaples(staples)
  }, [staples])

  const addStaple = useCallback((word) => {
    const w = word.trim().toLowerCase()
    if (!w) return
    setStaples((prev) => (prev.includes(w) ? prev : [...prev, w]))
  }, [])

  const removeStaple = useCallback((word) => {
    setStaples((prev) => prev.filter((s) => s !== word))
  }, [])

  return { staples, addStaple, removeStaple }
}
