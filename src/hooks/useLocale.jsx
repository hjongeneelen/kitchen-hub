import { createContext, useContext, useEffect, useState } from 'react'
import { SUPPORTED_LOCALES, translate } from '../lib/translations'

const STORAGE_KEY = 'kitchen-notebook-locale'
const CODES = SUPPORTED_LOCALES.map((l) => l.code)

function getInitialLocale() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (CODES.includes(stored)) return stored
  const browserLang = navigator.language?.slice(0, 2)
  return CODES.includes(browserLang) ? browserLang : 'en'
}

const LocaleContext = createContext(null)

export function LocaleProvider({ children }) {
  const [locale, setLocale] = useState(getInitialLocale)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale)
  }, [locale])

  const t = (key, params) => translate(locale, key, params)

  return <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>
}

export function useTranslation() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useTranslation must be used within a LocaleProvider')
  return ctx
}
