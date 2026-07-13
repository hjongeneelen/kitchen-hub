const keyFor = (slug) => `kitchen-hub:progress:${slug}`

/** @returns {{ingredients: object, steps: object} | null} null if never saved before */
export function loadProgress(slug) {
  try {
    const raw = localStorage.getItem(keyFor(slug))
    if (raw) return JSON.parse(raw)
  } catch {
    // localStorage unavailable or corrupt value
  }
  return null
}

export function saveProgress(slug, progress) {
  try {
    localStorage.setItem(keyFor(slug), JSON.stringify(progress))
  } catch {
    // localStorage unavailable (private browsing, quota) — progress just won't persist
  }
}
