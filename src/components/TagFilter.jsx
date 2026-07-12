export default function TagFilter({ tags, activeTags, onToggle }) {
  if (!tags.length) return null

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const active = activeTags.includes(tag)
        return (
          <button
            key={tag}
            onClick={() => onToggle(tag)}
            className={
              active
                ? 'tag-pill border-terracotta-500 bg-terracotta-500 text-cream-50'
                : 'tag-pill border-cream-300 bg-cream-50 text-charcoal-500 hover:border-terracotta-300 hover:text-terracotta-500 dark:border-charcoal-600 dark:bg-charcoal-800 dark:text-cream-200 dark:hover:border-terracotta-400'
            }
          >
            #{tag}
          </button>
        )
      })}
    </div>
  )
}
