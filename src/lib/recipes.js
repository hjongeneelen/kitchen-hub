import { parseFrontmatter } from './frontmatter'

// Vite statically analyzes this glob at build time and inlines every
// matching file as raw text — this is what makes the whole app buildable
// as a static site with zero server-side code.
const files = import.meta.glob('/_recipes/*.md', { query: '?raw', import: 'default', eager: true })

// Locales a recipe's content can be translated into, beyond however it was
// originally authored (the "base" language, whatever that is).
const TRANSLATABLE_LOCALES = ['nl', 'fr', 'de']
const INGREDIENTS_ALIASES = ['ingredients', 'ingrediënten', 'zutaten']
const STEPS_ALIASES = ['preparation', 'instructions', 'method', 'steps', 'bereiding', 'zubereitung']

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// Splits the markdown body into sections keyed by heading name, grouped per
// language via an optional "(nl)"/"(fr)" suffix on the "## Heading" line —
// e.g. "## Ingredients (nl)" holds the Dutch ingredient list alongside the
// base "## Ingredients" section (written in whatever language the recipe was
// originally authored in). Also extracts list items (checkbox-friendly) from
// each section.
function parseSections(content) {
  const lines = content.split(/\r?\n/)
  const sections = {} // sections[lang]['heading name'] = string[]; lang '' = base/as-authored
  let current = null

  for (const line of lines) {
    const heading = line.match(/^##\s+(.*)$/)
    if (heading) {
      const raw = heading[1].trim()
      const langMatch = raw.match(/^(.*?)\s*\(([a-z]{2})\)$/i)
      const name = (langMatch ? langMatch[1] : raw).trim().toLowerCase()
      const lang = langMatch ? langMatch[2].toLowerCase() : ''
      sections[lang] = sections[lang] || {}
      sections[lang][name] = []
      current = { lang, name }
      continue
    }
    if (!current) continue

    const item = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)$/)
    if (item && item[1].trim()) {
      sections[current.lang][current.name].push(item[1].trim())
    }
  }

  return sections
}

function findSection(sections, lang, candidates) {
  const bucket = sections[lang] || {}
  for (const name of candidates) {
    if (bucket[name]) return bucket[name]
  }
  return []
}

// Parses one recipe's raw markdown into the same shape used across the app —
// factored out so it can run both at build time (loadRecipes, over files
// discovered via import.meta.glob) and live in the browser (the editor's
// draft preview, over text that isn't a file yet).
export function parseRecipeMarkdown(raw, fallbackTitle = '') {
  const { data, content } = parseFrontmatter(raw)
  const sections = parseSections(content)

  const ingredients = findSection(sections, '', INGREDIENTS_ALIASES)
  const steps = findSection(sections, '', STEPS_ALIASES)

  const title = data.title || fallbackTitle
  const slug = data.slug ? slugify(String(data.slug)) : slugify(title)
  const description = data.description || ''

  // Per-locale overrides, only present when the recipe actually provides
  // that language — components fall back to the base fields otherwise.
  const translations = {}
  for (const lang of TRANSLATABLE_LOCALES) {
    const langIngredients = findSection(sections, lang, INGREDIENTS_ALIASES)
    const langSteps = findSection(sections, lang, STEPS_ALIASES)
    const langTitle = data[`title_${lang}`]
    const langDescription = data[`description_${lang}`]

    if (langTitle || langDescription || langIngredients.length || langSteps.length) {
      translations[lang] = {
        title: langTitle || title,
        description: langDescription || description,
        ingredients: langIngredients.length ? langIngredients : ingredients,
        steps: langSteps.length ? langSteps : steps,
      }
    }
  }

  return {
    slug,
    title,
    prepTime: data.prepTime || data.prep_time || '',
    portions: Number(data.portions || data.servings || 4),
    tags: Array.isArray(data.tags) ? data.tags : [],
    description,
    ingredients,
    steps,
    translations,
    content,
  }
}

function loadRecipes() {
  return Object.entries(files).map(([path, raw]) => {
    const filename = path.split('/').pop().replace(/\.md$/, '')
    return parseRecipeMarkdown(raw, filename)
  })
}

export const recipes = loadRecipes()

export function getRecipeBySlug(slug) {
  return recipes.find((r) => r.slug === slug)
}

export function getAllTags() {
  const tags = new Set()
  recipes.forEach((r) => r.tags.forEach((t) => tags.add(t)))
  return Array.from(tags).sort()
}

// Returns the recipe with title/description/ingredients/steps swapped for
// their `locale` translation, if the recipe has one — tags, portions,
// prepTime, and slug are language-independent and always come from the base
// recipe. Falls back to the base recipe untouched when no translation exists.
export function localizeRecipe(recipe, locale) {
  const t = recipe.translations[locale]
  if (!t) return recipe
  return { ...recipe, title: t.title, description: t.description, ingredients: t.ingredients, steps: t.steps }
}
