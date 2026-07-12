import { Link } from 'react-router-dom'
import { useTranslation } from '../hooks/useLocale.jsx'
import { localizeRecipe } from '../lib/recipes'

export default function RecipeCard({ recipe: baseRecipe }) {
  const { t, locale } = useTranslation()
  const recipe = localizeRecipe(baseRecipe, locale)

  return (
    <Link
      to={`/recipe/${recipe.slug}`}
      className="card flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
    >
      <h2 className="text-lg font-semibold leading-snug text-charcoal-800 dark:text-cream-50">
        {recipe.title}
      </h2>

      {recipe.description && (
        <p className="line-clamp-2 text-sm text-charcoal-400 dark:text-charcoal-200">
          {recipe.description}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-sm">
        {recipe.prepTime && (
          <span className="inline-flex items-center gap-1 text-olive-600 dark:text-olive-300">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
            </svg>
            {recipe.prepTime}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-terracotta-500 dark:text-terracotta-300">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          {t('portionsCount', { count: recipe.portions })}
        </span>
      </div>

      {recipe.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {recipe.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-olive-100 px-2 py-0.5 text-xs font-medium text-olive-700 dark:bg-olive-700/30 dark:text-olive-200"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}
