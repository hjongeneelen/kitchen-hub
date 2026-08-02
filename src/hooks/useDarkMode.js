import { useEffect, useState } from 'react'

const STORAGE_KEY = 'kitchen-notebook-theme'

function getInitialTheme() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  // Light is the default for first-time visitors, regardless of OS/browser
  // preference — the toggle is always right there if someone wants dark.
  return 'light'
}

export function useDarkMode() {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return [theme, toggle]
}
