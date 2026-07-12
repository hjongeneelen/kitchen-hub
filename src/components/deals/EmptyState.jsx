export default function EmptyState({ onReset }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-cream-300 bg-cream-50 px-6 py-16 text-center dark:border-charcoal-600 dark:bg-charcoal-800/40">
      <span className="text-4xl" aria-hidden="true">
        🛒
      </span>
      <h3 className="text-lg font-semibold text-charcoal-700 dark:text-cream-100">
        Geen aanbiedingen gevonden
      </h3>
      <p className="max-w-sm text-sm text-charcoal-400 dark:text-charcoal-200">
        Probeer een andere zoekterm of pas de winkelselectie aan. Sommige winkels zijn nog niet
        lokaal gescand en hebben daarom nog geen aanbiedingen.
      </p>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="mt-2 rounded-xl bg-terracotta-500 px-4 py-2 text-sm font-medium text-cream-50 transition-colors hover:bg-terracotta-600"
        >
          Filters wissen
        </button>
      )}
    </div>
  )
}
