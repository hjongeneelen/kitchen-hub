import { useEffect, useState } from 'react'

const dataUrl = (path) => `${import.meta.env.BASE_URL}data/${path}`

/**
 * Fetches data/index.json, then all per-store JSON files it references
 * (in parallel), and merges the results into a flat, store-tagged deal list.
 *
 * Stores that haven't been scraped yet (deal_count: 0, updated_at: null)
 * simply have no per-store file — a missing/404 file for such a store is
 * expected and is not treated as an error. An empty `stores` array (e.g.
 * before any scraping has run) is likewise not an error — it just yields
 * an empty deal list.
 */
export function useDeals() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [stores, setStores] = useState([])
  const [deals, setDeals] = useState([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const indexRes = await fetch(dataUrl('index.json'))
        if (!indexRes.ok) {
          throw new Error(`Kon index.json niet laden (status ${indexRes.status})`)
        }
        const index = await indexRes.json()
        if (cancelled) return

        setGeneratedAt(index.generated_at ?? null)
        setStores(index.stores ?? [])

        const scrapedStores = (index.stores ?? []).filter(
          (s) => s.deal_count > 0 && s.updated_at !== null
        )

        const results = await Promise.all(
          scrapedStores.map(async (s) => {
            try {
              const res = await fetch(dataUrl(`stores/${s.slug}.json`))
              if (!res.ok) return []
              const storeData = await res.json()
              return storeData.deals.map((d, i) => ({
                ...d,
                storeSlug: storeData.slug,
                storeName: storeData.store,
                storeMode: storeData.mode,
                id: `${storeData.slug}-${i}`,
              }))
            } catch {
              // A single store's file failing to load shouldn't break the
              // whole page — just contribute no deals for it.
              return []
            }
          })
        )

        if (cancelled) return
        setDeals(results.flat())
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Onbekende fout bij laden van data')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { loading, error, generatedAt, stores, deals }
}
