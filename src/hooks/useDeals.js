import { useEffect, useState } from 'react'

const dataUrl = (path) => `${import.meta.env.BASE_URL}data/${path}`

// Matches backend/modules/exporter.py's slugify() so a store name derived
// client-side (essentials items only have a "winkel" display name, no slug)
// lines up with the slugs used by the per-store flyer files.
const slugify = (name) => name.toLowerCase().replace(/\s+/g, '-')

/**
 * Fetches data/essentials.json (see backend main.py's --essentials pass) and
 * flattens its { items: { keyword: [match, ...] } } shape into deal-shaped
 * objects, tagged dealType: 'basisprijs' so DealCard can show a neutral
 * "actuele prijs" label instead of a discount badge. Missing file (feature
 * never run) is not an error — same tolerant pattern as a missing per-store
 * flyer file.
 */
async function fetchEssentialsAsDeals() {
  try {
    const res = await fetch(dataUrl('essentials.json'))
    if (!res.ok) return []
    const data = await res.json()
    const deals = []
    for (const [keyword, matches] of Object.entries(data.items ?? {})) {
      matches.forEach((m, i) => {
        if (!m.winkel) return
        deals.push({
          ...m,
          storeSlug: slugify(m.winkel),
          storeName: m.winkel,
          storeMode: 'essentials',
          dealType: 'basisprijs',
          id: `essentials-${slugify(keyword)}-${i}`,
        })
      })
    }
    return deals
  } catch {
    return []
  }
}

/**
 * Fetches data/index.json, then all per-store JSON files it references
 * (in parallel), plus data/essentials.json (everyday staples with a live
 * current price regardless of whether they're on sale — see
 * fetchEssentialsAsDeals), and merges everything into a flat, store-tagged
 * deal list.
 *
 * Stores that haven't been scraped yet (deal_count: 0, updated_at: null)
 * simply have no per-store file — a missing/404 file for such a store is
 * expected and is not treated as an error. An empty `stores` array (e.g.
 * before any scraping has run) is likewise not an error — it just yields
 * an empty deal list.
 *
 * `stores` (used to populate the store filter bar) is the union of
 * index.json's flyer-scraped stores and whatever stores essentials.json
 * happens to surface (e.g. Vomar, Coop — stores with zero flyer coverage but
 * that still turned up a current price for some everyday product).
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

        const [flyerResults, essentialsDeals] = await Promise.all([
          Promise.all(
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
                  dealType: 'aanbieding',
                  id: `${storeData.slug}-${i}`,
                }))
              } catch {
                // A single store's file failing to load shouldn't break the
                // whole page — just contribute no deals for it.
                return []
              }
            })
          ),
          fetchEssentialsAsDeals(),
        ])

        if (cancelled) return
        const mergedDeals = [...flyerResults.flat(), ...essentialsDeals]
        setDeals(mergedDeals)

        // Stores essentials.json surfaced that index.json doesn't know about
        // (zero flyer coverage, but a current price for some staple) still
        // need to show up as filter options — with a real deal_count/updated_at
        // (not undefined) so StoreFilterBar's "hasData"/count-badge logic
        // treats them the same as a flyer-scraped store instead of rendering
        // an "undefined" badge and a misleading "Nog niet gescand" tooltip.
        const knownSlugs = new Set((index.stores ?? []).map((s) => s.slug))
        const extraStoreCounts = new Map()
        for (const d of essentialsDeals) {
          if (!knownSlugs.has(d.storeSlug)) {
            extraStoreCounts.set(d.storeSlug, {
              slug: d.storeSlug,
              name: d.storeName,
              mode: 'essentials',
              deal_count: (extraStoreCounts.get(d.storeSlug)?.deal_count ?? 0) + 1,
              updated_at: 'essentials',
            })
          }
        }
        if (extraStoreCounts.size > 0) {
          setStores([...(index.stores ?? []), ...extraStoreCounts.values()])
        }
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
