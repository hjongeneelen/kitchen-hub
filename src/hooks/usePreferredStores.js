import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadPreferredStores, savePreferredStores } from '../lib/preferredStores'

/**
 * Persistent (localStorage) set of stores the user actually plans to visit
 * this shopping trip — empty means "no restriction, cheapest anywhere"
 * (today's behavior). Used to scope estimateRecipeCost/pickBestMatch (see
 * lib/ingredientCost.js) so the same choice applies consistently on both
 * the Shopping List and individual recipe pages.
 */
export function usePreferredStores() {
  const [stores, setStores] = useState(loadPreferredStores)

  useEffect(() => {
    savePreferredStores(stores)
  }, [stores])

  const toggleStore = useCallback((name) => {
    setStores((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]))
  }, [])

  const clearStores = useCallback(() => setStores([]), [])

  const storeScope = useMemo(() => new Set(stores), [stores])

  return { stores, storeScope, toggleStore, clearStores }
}
