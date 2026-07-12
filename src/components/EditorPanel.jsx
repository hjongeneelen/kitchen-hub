import { useEffect, useMemo, useRef, useState } from 'react'
import { RECIPE_FORMAT_SYSTEM_PROMPT } from '../lib/recipeFormatPrompt.js'
import { RECIPE_PREFERENCES } from '../lib/recipePreferences.js'
import { AUTO_TAG_PROMPT } from '../lib/autoTagPrompt.js'
import { parseFrontmatter } from '../lib/frontmatter.js'
import { parseRecipeMarkdown, localizeRecipe } from '../lib/recipes.js'
import { useTranslation } from '../hooks/useLocale.jsx'

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function deriveFilename(raw) {
  const match = raw.match(/^title:\s*(.+)$/m)
  if (!match) return ''
  const slug = slugify(match[1].trim())
  return slug ? `${slug}.md` : ''
}

// Shows the recipe's title in whichever language the app is currently
// displaying (falling back to the base title, then the filename) instead of
// the raw kebab-case filename — the list is for picking a recipe to talk
// about, not for reading markdown.
function displayTitle(raw, locale, fallback) {
  const { data } = parseFrontmatter(raw)
  return data[`title_${locale}`] || data.title || fallback
}

function extractMarkdown(text) {
  const fenced = text.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/)
  return (fenced ? fenced[1] : text).trim()
}

// Renders a parsed draft the same way a real recipe page would — used
// instead of showing the raw frontmatter/heading soup, especially now that a
// full draft runs to 8 sections across 4 languages.
function RecipePreview({ recipe }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-bold text-charcoal-800 dark:text-cream-50">
          {recipe.title || '(untitled)'}
        </h3>
        {recipe.description && (
          <p className="mt-1 text-sm text-charcoal-500 dark:text-charcoal-300">{recipe.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-charcoal-400 dark:text-charcoal-300">
          {recipe.prepTime && <span>⏱ {recipe.prepTime}</span>}
          <span>🍽 {recipe.portions} portions</span>
          {recipe.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-olive-100 px-2 py-0.5 font-medium text-olive-700 dark:bg-olive-700/30 dark:text-olive-200"
            >
              #{tag}
            </span>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-terracotta-600 dark:text-terracotta-300">
          Ingredients
        </h4>
        {recipe.ingredients.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-charcoal-700 dark:text-cream-100">
            {recipe.ingredients.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm italic text-charcoal-400">No ingredients yet.</p>
        )}
      </div>

      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-terracotta-600 dark:text-terracotta-300">
          Preparation
        </h4>
        {recipe.steps.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-charcoal-700 dark:text-cream-100">
            {recipe.steps.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        ) : (
          <p className="text-sm italic text-charcoal-400">No steps yet.</p>
        )}
      </div>
    </div>
  )
}

// The chat-with-local-LLM + recipe list/draft UI, shared by the full-page
// /editor route and the floating ChatDrawer available on every page — one
// implementation, two places to mount it.
export default function EditorPanel({ compact = false }) {
  const { locale } = useTranslation()
  const [recipes, setRecipes] = useState([])
  const [selectedFilename, setSelectedFilename] = useState(null)
  const [filenameInput, setFilenameInput] = useState('')
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [error, setError] = useState(null)
  const [showDraft, setShowDraft] = useState(!compact)
  const [tagProgress, setTagProgress] = useState(null)
  const [rawMode, setRawMode] = useState(false)
  const [previewLocale, setPreviewLocale] = useState('en')
  const [preferencesText, setPreferencesText] = useState(RECIPE_PREFERENCES)
  const [preferencesDraft, setPreferencesDraft] = useState(RECIPE_PREFERENCES)
  const [showPreferences, setShowPreferences] = useState(false)
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const chatEndRef = useRef(null)

  const systemPrompt = useMemo(
    () => `${RECIPE_FORMAT_SYSTEM_PROMPT}\n\n${preferencesText}`,
    [preferencesText]
  )

  const parsedDraft = useMemo(() => (draft.trim() ? parseRecipeMarkdown(draft) : null), [draft])
  const availableLocales = useMemo(
    () => (parsedDraft ? ['en', ...Object.keys(parsedDraft.translations)] : ['en']),
    [parsedDraft]
  )
  const previewRecipe = useMemo(() => {
    if (!parsedDraft) return null
    return previewLocale === 'en' ? parsedDraft : localizeRecipe(parsedDraft, previewLocale)
  }, [parsedDraft, previewLocale])

  useEffect(() => {
    if (!availableLocales.includes(previewLocale)) setPreviewLocale('en')
  }, [availableLocales, previewLocale])

  const loadRecipes = () => {
    fetch('/api/recipes')
      .then((r) => r.json())
      .then((data) => setRecipes(data.recipes || []))
      .catch(() => setError('Could not reach the dev API. Are you running `npm run dev`?'))
  }

  useEffect(loadRecipes, [])
  useEffect(() => {
    fetch('/api/preferences')
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.text === 'string') {
          setPreferencesText(data.text)
          setPreferencesDraft(data.text)
        }
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const selectRecipe = (recipe) => {
    setSelectedFilename(recipe.filename)
    setFilenameInput(recipe.filename)
    setDraft(recipe.raw)
    setMessages([])
    setError(null)
    setRawMode(false)
    setPreviewLocale(locale)
    if (compact) setShowDraft(true)
  }

  const newRecipe = () => {
    setSelectedFilename(null)
    setFilenameInput('')
    setDraft('')
    setMessages([])
    setError(null)
    setRawMode(false)
    setPreviewLocale('en')
  }

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return
    const nextMessages = [...messages, { role: 'user', content: chatInput.trim() }]
    setMessages(nextMessages)
    setChatInput('')
    setChatLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'system', content: systemPrompt }, ...nextMessages],
          tools: ['save_recipe'],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'LLM request failed')
      setMessages([...nextMessages, { role: 'assistant', content: data.reply }])

      if (data.saved) {
        setSelectedFilename(data.saved.filename)
        setFilenameInput(data.saved.filename)
        setDraft(data.saved.content)
        setSaveState('saved')
        loadRecipes()
        if (compact) setShowDraft(true)
        setTimeout(() => setSaveState('idle'), 2000)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setChatLoading(false)
    }
  }

  const insertLastReply = () => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    if (!lastAssistant) return
    const markdown = extractMarkdown(lastAssistant.content)
    setDraft(markdown)
    if (!filenameInput) setFilenameInput(deriveFilename(markdown))
    if (compact) setShowDraft(true)
  }

  const saveDraft = async () => {
    let filename = filenameInput.trim()
    if (!filename) filename = deriveFilename(draft)
    if (!filename.endsWith('.md')) filename = `${filename}.md`
    if (!/^[a-z0-9-]+\.md$/i.test(filename)) {
      setError('Filename must be lowercase letters, numbers, and dashes only (e.g. my-recipe.md).')
      return
    }

    setSaveState('saving')
    setError(null)
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: draft }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setFilenameInput(filename)
      setSelectedFilename(filename)
      setSaveState('saved')
      loadRecipes()
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (err) {
      setError(err.message)
      setSaveState('idle')
    }
  }

  const deleteRecipe = async (filename) => {
    if (!confirm(`Delete ${filename}? This can't be undone.`)) return
    try {
      const res = await fetch('/api/recipes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed')
      if (selectedFilename === filename) newRecipe()
      loadRecipes()
    } catch (err) {
      setError(err.message)
    }
  }

  const autoTagAll = async () => {
    setError(null)
    const targets = [...recipes]
    const log = []

    for (let i = 0; i < targets.length; i++) {
      const r = targets[i]
      setTagProgress({ current: i + 1, total: targets.length, filename: r.filename })
      try {
        const res = await fetch('/api/llm/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: AUTO_TAG_PROMPT },
              { role: 'user', content: `Filename: ${r.filename}\n\n${r.raw}` },
            ],
            tools: ['update_recipe_tags'],
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Request failed')
        log.push({ role: 'assistant', content: `${r.filename} → ${data.reply}` })
      } catch (err) {
        log.push({ role: 'assistant', content: `${r.filename} → failed: ${err.message}` })
      }
    }

    setMessages((prev) => [...prev, { role: 'user', content: 'Auto-tag all recipes' }, ...log])
    setTagProgress(null)
    loadRecipes()
  }

  const openPreferences = () => {
    setPreferencesDraft(preferencesText)
    setShowPreferences(true)
  }

  const savePreferences = async () => {
    setPreferencesSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: preferencesDraft }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      setPreferencesText(preferencesDraft)
      setShowPreferences(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setPreferencesSaving(false)
    }
  }

  return (
    <div className={compact ? 'flex h-full flex-col gap-3' : 'grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr_1fr]'}>
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      <section className={compact ? 'card p-3' : 'card p-3'}>
        <div className="mb-2 flex items-center gap-2">
          <button
            onClick={newRecipe}
            className="flex-1 rounded-lg bg-terracotta-500 px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-600"
          >
            + New recipe
          </button>
          <button
            onClick={openPreferences}
            title="Standing preferences (memory)"
            aria-label="Standing preferences (memory)"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cream-300 text-charcoal-500 hover:bg-cream-200 dark:border-charcoal-600 dark:text-charcoal-300 dark:hover:bg-charcoal-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a7.65 7.65 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
        <button
          onClick={autoTagAll}
          disabled={!!tagProgress || recipes.length === 0}
          className="mb-2 w-full rounded-lg border border-olive-400 px-3 py-2 text-xs font-medium text-olive-600 hover:bg-olive-50 disabled:opacity-50 dark:text-olive-300 dark:hover:bg-olive-900/20"
        >
          {tagProgress
            ? `Tagging ${tagProgress.current}/${tagProgress.total}…`
            : 'Auto-tag all recipes'}
        </button>
        <ul className={compact ? 'flex flex-wrap gap-1' : 'flex flex-col gap-1'}>
          {recipes.map((r) => (
            <li key={r.filename} className="flex items-center gap-1">
              <button
                onClick={() => selectRecipe(r)}
                className={`truncate rounded-lg px-2 py-1 text-left text-sm hover:bg-cream-200 dark:hover:bg-charcoal-700 ${
                  compact ? 'max-w-[10rem]' : 'flex-1'
                } ${selectedFilename === r.filename ? 'bg-cream-200 dark:bg-charcoal-700' : ''}`}
                title={r.filename}
              >
                {displayTitle(r.raw, locale, r.filename.replace(/\.md$/, ''))}
              </button>
              <button
                onClick={() => deleteRecipe(r.filename)}
                className="rounded px-1 text-xs text-charcoal-300 hover:text-red-500"
                title="Delete"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={`card flex flex-col p-3 ${compact ? 'flex-1 overflow-hidden' : ''}`}>
        <h2 className="mb-2 text-sm font-semibold text-terracotta-600 dark:text-terracotta-300">
          Talk to your local LLM
        </h2>
        <div
          className="mb-2 flex-1 space-y-2 overflow-y-auto rounded-lg bg-cream-100 p-2 dark:bg-charcoal-900"
          style={compact ? { minHeight: 120 } : { minHeight: 300, maxHeight: 420 }}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'ml-6 bg-terracotta-100 dark:bg-terracotta-900/40'
                  : 'mr-6 bg-olive-100 dark:bg-olive-900/30'
              }`}
            >
              {m.content}
            </div>
          ))}
          {chatLoading && <div className="mr-6 text-sm italic text-charcoal-400">Thinking…</div>}
          <div ref={chatEndRef} />
        </div>
        <textarea
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendChat()
            }
          }}
          placeholder="Paste a recipe, describe changes, or say 'save it' when you're happy…"
          className={`mb-2 w-full rounded-lg border border-cream-300 bg-cream-50 p-2 text-sm dark:border-charcoal-600 dark:bg-charcoal-800 ${
            compact ? 'h-14' : 'h-20'
          }`}
        />
        <div className="flex gap-2">
          <button
            onClick={sendChat}
            disabled={chatLoading}
            className="flex-1 rounded-lg bg-olive-500 px-3 py-2 text-sm font-medium text-white hover:bg-olive-600 disabled:opacity-50"
          >
            Send
          </button>
          <button
            onClick={insertLastReply}
            disabled={!messages.some((m) => m.role === 'assistant')}
            className="flex-1 rounded-lg border border-olive-400 px-3 py-2 text-sm font-medium text-olive-600 hover:bg-olive-50 disabled:opacity-50 dark:text-olive-300 dark:hover:bg-olive-900/20"
          >
            {compact ? 'Insert →' : 'Insert reply into draft →'}
          </button>
        </div>
      </section>

      {(!compact || showDraft) && (
        <section className="card flex flex-col p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-terracotta-600 dark:text-terracotta-300">
              Recipe draft
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setRawMode((v) => !v)}
                disabled={!parsedDraft}
                className="text-xs font-medium text-olive-600 hover:text-olive-700 disabled:opacity-40 dark:text-olive-300 dark:hover:text-olive-200"
              >
                {rawMode ? '← Back to preview' : 'Edit raw markdown →'}
              </button>
              {compact && (
                <button
                  onClick={() => setShowDraft(false)}
                  className="text-xs text-charcoal-400 hover:text-charcoal-600 dark:hover:text-charcoal-200"
                >
                  Hide
                </button>
              )}
            </div>
          </div>

          <input
            value={filenameInput}
            onChange={(e) => setFilenameInput(e.target.value)}
            placeholder="filename.md (auto-filled from title)"
            className="mb-2 rounded-lg border border-cream-300 bg-cream-50 p-2 text-sm dark:border-charcoal-600 dark:bg-charcoal-800"
          />

          {!rawMode && availableLocales.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {availableLocales.map((loc) => (
                <button
                  key={loc}
                  onClick={() => setPreviewLocale(loc)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    previewLocale === loc
                      ? 'bg-terracotta-500 text-white'
                      : 'bg-cream-200 text-charcoal-600 dark:bg-charcoal-700 dark:text-charcoal-200'
                  }`}
                >
                  {loc.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <div
            className="mb-2 flex-1 overflow-y-auto rounded-lg border border-cream-300 bg-cream-50 dark:border-charcoal-600 dark:bg-charcoal-800"
            style={{ minHeight: compact ? 260 : 420, maxHeight: compact ? 420 : 560 }}
          >
            {rawMode ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="---&#10;title: ...&#10;---"
                className="h-full min-h-[inherit] w-full resize-none rounded-lg bg-transparent p-3 font-mono text-xs text-charcoal-800 dark:text-cream-100"
              />
            ) : previewRecipe ? (
              <div className="p-3">
                <RecipePreview recipe={previewRecipe} />
              </div>
            ) : (
              <p className="p-3 text-sm italic text-charcoal-400">
                Nothing to preview yet — chat with the assistant, or click "Edit raw markdown" to paste one in directly.
              </p>
            )}
          </div>

          <button
            onClick={saveDraft}
            disabled={!draft.trim() || saveState === 'saving'}
            className="rounded-lg bg-terracotta-500 px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-600 disabled:opacity-50"
          >
            {saveState === 'saved' ? 'Saved ✓' : saveState === 'saving' ? 'Saving…' : 'Save recipe'}
          </button>
        </section>
      )}

      {compact && !showDraft && draft.trim() && (
        <button
          onClick={() => setShowDraft(true)}
          className="rounded-lg border border-terracotta-300 px-3 py-2 text-sm font-medium text-terracotta-600 hover:bg-terracotta-50 dark:border-terracotta-700 dark:text-terracotta-300 dark:hover:bg-terracotta-900/20"
        >
          Show draft ({filenameInput || 'untitled'})
        </button>
      )}

      {showPreferences && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setShowPreferences(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-cream-50 p-4 shadow-2xl dark:bg-charcoal-800"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-sm font-semibold text-terracotta-600 dark:text-terracotta-300">
              Standing preferences (memory)
            </h3>
            <p className="mb-2 text-xs text-charcoal-400">
              Things the assistant should always remember — portion sizes, dietary notes, how detailed steps should
              be. Applied to every conversation, on top of the format rules.
            </p>
            <textarea
              value={preferencesDraft}
              onChange={(e) => setPreferencesDraft(e.target.value)}
              className="mb-3 h-64 w-full rounded-lg border border-cream-300 bg-cream-50 p-2 text-sm dark:border-charcoal-600 dark:bg-charcoal-900 dark:text-cream-100"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowPreferences(false)}
                className="rounded-lg px-3 py-2 text-sm text-charcoal-500 hover:bg-cream-200 dark:text-charcoal-300 dark:hover:bg-charcoal-700"
              >
                Cancel
              </button>
              <button
                onClick={savePreferences}
                disabled={preferencesSaving}
                className="rounded-lg bg-terracotta-500 px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-600 disabled:opacity-50"
              >
                {preferencesSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
