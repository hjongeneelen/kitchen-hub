import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePantryStaples } from '../hooks/usePantryStaples.js'
import DarkModeToggle from '../components/DarkModeToggle.jsx'

export default function Pantry() {
  const { staples, addStaple, removeStaple } = usePantryStaples()
  const [input, setInput] = useState('')

  const submit = (e) => {
    e.preventDefault()
    addStaple(input)
    setInput('')
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-16 pt-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-terracotta-500 hover:text-terracotta-600 dark:text-terracotta-300"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Alle recepten
        </Link>
        <DarkModeToggle />
      </header>

      <h1 className="text-2xl font-bold leading-tight text-charcoal-800 dark:text-cream-50">
        Vaste voorraad
      </h1>
      <p className="mt-2 text-charcoal-500 dark:text-charcoal-200">
        Ingrediënten die je altijd in huis hebt (ui, knoflook, olie, ...). Die worden op elke
        receptpagina automatisch al aangevinkt en tellen niet mee in de geschatte
        boodschappenkosten — je hoeft ze immers niet te kopen.
      </p>
      <p className="mt-2 text-sm text-charcoal-400 dark:text-charcoal-300">
        Tip: voeg toe in het Engels (bv. "onion" i.p.v. "ui") — recepten worden intern in het
        Engels opgeslagen, dus dat matcht het meest betrouwbaar, ongeacht welke taal je net kiest.
      </p>

      <form onSubmit={submit} className="mt-6 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="bv. onion, garlic, oil..."
          className="flex-1 rounded-lg border border-cream-300 bg-cream-50 px-3 py-2 text-charcoal-800 placeholder:text-charcoal-300 focus:border-terracotta-400 focus:ring-2 focus:ring-terracotta-400/30 focus:outline-none dark:border-charcoal-600 dark:bg-charcoal-700 dark:text-cream-50 dark:placeholder:text-charcoal-400"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-terracotta-500 px-4 py-2 font-medium text-cream-50 transition hover:bg-terracotta-600"
        >
          Toevoegen
        </button>
      </form>

      <div className="mt-6 flex flex-wrap gap-2">
        {staples.length === 0 && (
          <p className="text-charcoal-300 dark:text-charcoal-400">
            Nog niets toegevoegd — alle ingrediënten tellen dus mee.
          </p>
        )}
        {staples.map((staple) => (
          <span
            key={staple}
            className="tag-pill border-olive-300 bg-olive-100 text-olive-700 dark:border-olive-600 dark:bg-olive-700/30 dark:text-olive-200"
          >
            {staple}
            <button
              onClick={() => removeStaple(staple)}
              aria-label={`Verwijder ${staple}`}
              className="ml-1.5 text-olive-500 hover:text-olive-800 dark:text-olive-300 dark:hover:text-olive-50"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
