import { useState } from 'react'
import EditorPanel from './EditorPanel.jsx'

// Floating tab, present on every page (dev-only — see App.jsx), that slides
// in the same chat-with-local-LLM UI used on the full /editor page. Lets you
// keep looking at a recipe (or the home list) while talking to the model,
// instead of navigating away to /editor and losing your place.
export default function ChatDrawer() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl border border-r-0 border-terracotta-300/50 bg-terracotta-500 px-2 py-3 text-xs font-semibold text-white shadow-lg transition hover:bg-terracotta-600 dark:border-charcoal-600"
        style={{ writingMode: 'vertical-rl' }}
        aria-label="Toggle LLM chat"
      >
        {open ? 'Close' : 'Chat'}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/20"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col overflow-y-auto border-l border-cream-300 bg-cream-100 p-3 shadow-2xl dark:border-charcoal-600 dark:bg-charcoal-900">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-charcoal-800 dark:text-cream-50">
                Recipe Assistant <span className="text-xs font-normal text-charcoal-400">(dev only)</span>
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-sm text-charcoal-400 hover:text-charcoal-700 dark:hover:text-cream-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <EditorPanel compact />
          </div>
        </>
      )}
    </>
  )
}
