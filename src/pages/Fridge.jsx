import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { recipes } from '../lib/recipes'
import { FRIDGE_ASSISTANT_PROMPT } from '../lib/fridgeAssistantPrompt.js'
import { useTranslation } from '../hooks/useLocale.jsx'
import DarkModeToggle from '../components/DarkModeToggle.jsx'

const INBOX_PATH = '_fridge/inbox.md'

function recipeSummary() {
  return recipes.map((r) => `- ${r.title}: ${r.ingredients.join(', ')}`).join('\n')
}

export default function Fridge() {
  const { t } = useTranslation()
  const [items, setItems] = useState([])
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [error, setError] = useState(null)
  const [inboxText, setInboxText] = useState('')
  const [inboxNotice, setInboxNotice] = useState(null)
  const [processingInbox, setProcessingInbox] = useState(false)
  const chatEndRef = useRef(null)

  const loadFridge = () => {
    fetch('/api/fridge')
      .then((r) => r.json())
      .then((data) => setItems(data.items || []))
      .catch(() => setError(t('fridgeApiError')))
  }

  // Notes jotted through github.com's web editor while away (see
  // _fridge/inbox.md) — surfaced here so they can be folded into the
  // structured fridge list once the local LLM is actually available.
  const loadInbox = () => {
    fetch('/api/fridge/inbox')
      .then((r) => r.json())
      .then((data) => setInboxText(data.text || ''))
      .catch(() => {
        // Dev-only convenience — if unreachable, just show no banner.
      })
  }

  useEffect(loadFridge, [])
  useEffect(loadInbox, [])
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const removeItem = async (item) => {
    const next = items.filter((i) => i !== item)
    setItems(next)
    try {
      const res = await fetch('/api/fridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next }),
      })
      if (!res.ok) throw new Error((await res.json()).error || t('fridgeUpdateFailed'))
    } catch (err) {
      setError(err.message)
      loadFridge()
    }
  }

  const send = async (userText) => {
    if (!userText.trim() || chatLoading) return false
    const nextMessages = [...messages, { role: 'user', content: userText.trim() }]
    setMessages(nextMessages)
    setChatLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'system', content: FRIDGE_ASSISTANT_PROMPT }, ...nextMessages],
          tools: ['update_fridge_items'],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || t('fridgeLlmRequestFailed'))
      setMessages([...nextMessages, { role: 'assistant', content: data.reply }])
      if (data.fridge) {
        setItems(data.fridge.items)
        return true
      }
      return false
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setChatLoading(false)
    }
  }

  const sendChat = () => {
    const text = chatInput
    setChatInput('')
    send(text)
  }

  const askWhatToCook = () => {
    send(t('fridgeAskWhatToCookMessage', { recipes: recipeSummary() }))
  }

  const processInbox = async () => {
    if (!inboxText.trim() || processingInbox) return
    setProcessingInbox(true)
    setInboxNotice(null)

    const ok = await send(t('fridgeInboxProcessMessage', { notes: inboxText }))

    if (ok) {
      try {
        await fetch('/api/fridge/inbox', { method: 'POST' })
      } catch {
        // The fridge itself is already updated at this point — a failed
        // archive call just means the note stays visible next reload too.
      }
      setInboxText('')
      setInboxNotice(t('fridgeProcessedNotice', { file: INBOX_PATH }))
    } else {
      setInboxNotice(t('fridgeProcessFailedNotice'))
    }
    setProcessingInbox(false)
  }

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 pb-16 pt-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-terracotta-500 hover:text-terracotta-600 dark:text-terracotta-300"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          {t('allRecipes')}
        </Link>
        <h1 className="text-lg font-bold text-charcoal-800 dark:text-cream-50">
          {t('fridgeTitle')} <span className="text-xs font-normal text-charcoal-400">{t('devOnly')}</span>
        </h1>
        <DarkModeToggle />
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {inboxText && (
        <div className="mb-4 rounded-xl border border-olive-300 bg-olive-50 p-3 dark:border-olive-700 dark:bg-olive-900/20">
          <p className="mb-1 text-sm font-semibold text-olive-700 dark:text-olive-300">
            {t('fridgeInboxFound', { file: INBOX_PATH })}
          </p>
          <p className="mb-2 whitespace-pre-wrap rounded-lg bg-cream-50 p-2 text-sm text-charcoal-600 dark:bg-charcoal-900 dark:text-charcoal-100">
            {inboxText}
          </p>
          <button
            onClick={processInbox}
            disabled={processingInbox || chatLoading}
            className="rounded-lg bg-olive-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-olive-600 disabled:opacity-50"
          >
            {processingInbox ? t('fridgeProcessing') : t('fridgeProcess')}
          </button>
        </div>
      )}

      {inboxNotice && (
        <p className="mb-4 text-xs text-charcoal-400 dark:text-charcoal-300">{inboxNotice}</p>
      )}

      <section className="card mb-4 p-3">
        <h2 className="mb-2 text-sm font-semibold text-terracotta-600 dark:text-terracotta-300">
          {t('fridgeWhatsInside')}
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-charcoal-400">{t('fridgeEmpty')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1 rounded-full bg-olive-100 px-2.5 py-1 text-xs font-medium text-olive-700 dark:bg-olive-700/30 dark:text-olive-200"
              >
                {item}
                <button
                  onClick={() => removeItem(item)}
                  className="text-olive-500 hover:text-red-500 dark:text-olive-300"
                  aria-label={t('fridgeRemoveItem', { item })}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card flex flex-col p-3">
        <h2 className="mb-2 text-sm font-semibold text-terracotta-600 dark:text-terracotta-300">
          {t('fridgeTalkToLlm')}
        </h2>
        <div
          className="mb-2 flex-1 space-y-2 overflow-y-auto rounded-lg bg-cream-100 p-2 dark:bg-charcoal-900"
          style={{ minHeight: 240, maxHeight: 420 }}
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
          {chatLoading && <div className="mr-6 text-sm italic text-charcoal-400">{t('fridgeThinking')}</div>}
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
          placeholder={t('fridgePlaceholder')}
          className="mb-2 h-20 w-full rounded-lg border border-cream-300 bg-cream-50 p-2 text-sm dark:border-charcoal-600 dark:bg-charcoal-800"
        />
        <div className="flex gap-2">
          <button
            onClick={sendChat}
            disabled={chatLoading}
            className="flex-1 rounded-lg bg-olive-500 px-3 py-2 text-sm font-medium text-white hover:bg-olive-600 disabled:opacity-50"
          >
            {t('send')}
          </button>
          <button
            onClick={askWhatToCook}
            disabled={chatLoading || items.length === 0}
            className="flex-1 rounded-lg border border-terracotta-400 px-3 py-2 text-sm font-medium text-terracotta-600 hover:bg-terracotta-50 disabled:opacity-50 dark:text-terracotta-300 dark:hover:bg-terracotta-900/20"
          >
            {t('fridgeAskWhatToCook')}
          </button>
        </div>
      </section>
    </div>
  )
}
