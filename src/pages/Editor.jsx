import { Link } from 'react-router-dom'
import DarkModeToggle from '../components/DarkModeToggle.jsx'
import EditorPanel from '../components/EditorPanel.jsx'

export default function Editor() {
  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-16 pt-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-terracotta-500 hover:text-terracotta-600 dark:text-terracotta-300"
        >
          ← All recipes
        </Link>
        <h1 className="text-lg font-bold text-charcoal-800 dark:text-cream-50">
          Recipe Editor <span className="text-xs font-normal text-charcoal-400">(dev only)</span>
        </h1>
        <DarkModeToggle />
      </header>

      <EditorPanel />
    </div>
  )
}
