import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RECIPES_DIR = path.join(ROOT, '_recipes')
const FRIDGE_PATH = path.join(ROOT, 'fridge.json')
const PREFERENCES_PATH = path.join(ROOT, 'preferences.json')

// Seed used the first time preferences.json doesn't exist yet — kept in sync
// with src/lib/recipePreferences.js's default (that file is the client's
// fallback if /api/preferences can't be reached; this is the server's seed).
const DEFAULT_PREFERENCES_TEXT = `Hugo's standing preferences (apply by default; anything he says in the conversation overrides these):

- Portion sizes are generous — Hugo is a big eater. Per portion, unless he asks for less:
  - Rice: 150 g (uncooked weight) per portion.
  - Pasta: 125 g minimum per portion — for example, 4 portions of pasta means 500 g total, not less.
  - For other mains/staples without a listed default, size the portion generously rather than conservatively.
  - Multiply the per-portion amount by the recipe's portions count for the total ingredient quantity.
- Always give a complete Ingredients list and a detailed, numbered Preparation plan. Never shorten steps at the expense of clarity.`

// Only allows simple, non-nested filenames (no path traversal).
function isSafeFilename(name) {
  return typeof name === 'string' && /^[a-z0-9-]+\.md$/i.test(name)
}

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// Best-effort filename for a tool call that omitted or mangled one — falls
// back to slugifying the frontmatter title, mirroring the client-side
// `deriveFilename` in EditorPanel.jsx so a saved-via-chat recipe ends up
// named the same way a saved-via-button one would.
function resolveFilename(candidate, content) {
  if (isSafeFilename(candidate)) return candidate
  const titleMatch = typeof content === 'string' && content.match(/^title:\s*(.+)$/m)
  if (titleMatch) {
    const slug = slugify(titleMatch[1].trim())
    if (slug) return `${slug}.md`
  }
  return null
}

function saveRecipe(filename, content) {
  fs.writeFileSync(path.join(RECIPES_DIR, filename), content, 'utf-8')
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

function loadFridge() {
  const data = readJsonFile(FRIDGE_PATH, { items: [] })
  return { items: Array.isArray(data.items) ? data.items.map(String) : [] }
}

function saveFridge(items) {
  fs.writeFileSync(FRIDGE_PATH, JSON.stringify({ items }, null, 2), 'utf-8')
}

function loadPreferences() {
  const data = readJsonFile(PREFERENCES_PATH, null)
  return data && typeof data.text === 'string' ? data.text : DEFAULT_PREFERENCES_TEXT
}

function savePreferencesText(text) {
  fs.writeFileSync(PREFERENCES_PATH, JSON.stringify({ text }, null, 2), 'utf-8')
}

function updateRecipeTags(filename, tags) {
  if (!isSafeFilename(filename)) return { ok: false, resultText: `Invalid filename: ${filename}`, retryable: true }
  const target = path.join(RECIPES_DIR, filename)
  if (!fs.existsSync(target)) return { ok: false, resultText: `Recipe not found: ${filename}`, retryable: true }

  const raw = fs.readFileSync(target, 'utf-8')
  const cleanTags = tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
  const tagsLine = `tags: [${cleanTags.join(', ')}]`

  let updated
  if (/^tags:.*$/m.test(raw)) {
    updated = raw.replace(/^tags:.*$/m, tagsLine)
  } else if (/^tag:.*$/m.test(raw)) {
    updated = raw.replace(/^tag:.*$/m, tagsLine)
  } else {
    updated = raw.replace(/^(title:.*)$/m, `$1\n${tagsLine}`)
  }

  fs.writeFileSync(target, updated, 'utf-8')
  return { ok: true, resultText: `Updated tags for ${filename}: [${cleanTags.join(', ')}]`, extra: { retaggedFilename: filename } }
}

// Catches the format mistakes that silently corrupt a recipe instead of
// throwing — most importantly a missing closing "---" (frontmatter.js then
// treats the WHOLE file as unparsed body text, so title/tags/portions all
// vanish with no error) and "tag:" instead of "tags:" (both seen in practice
// from small local models). Used before every write, manual or tool-called.
// Missing NL/FR/DE translations are `warnings`, not `errors` — the app falls
// back to the base language per-field, so an incomplete translation should
// never block a save, only get flagged.
function validateRecipeMarkdown(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return { valid: false, errors: ['content is empty'], warnings: [] }
  }

  const errors = []
  const warnings = []
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!fmMatch) {
    return {
      valid: false,
      errors: ['missing the closing "---" line that ends the frontmatter block (both an opening and a closing "---" are required)'],
      warnings: [],
    }
  }

  const [, frontmatter, body] = fmMatch
  if (!/^title:\s*\S/m.test(frontmatter)) errors.push('frontmatter is missing a "title:" line')
  if (/^tag:\s*/m.test(frontmatter) && !/^tags:\s*/m.test(frontmatter)) {
    errors.push('frontmatter has "tag:" but the key must be "tags:" (plural)')
  } else if (!/^tags:\s*/m.test(frontmatter)) {
    errors.push('frontmatter is missing a "tags:" line (use "tags: []" if there are none)')
  }
  if (!/^portions:\s*\d/m.test(frontmatter)) errors.push('frontmatter is missing a numeric "portions:" line')
  if (!/^##\s+ingredients\s*$/im.test(body)) errors.push('body is missing a "## Ingredients" heading')
  if (!/^##\s+preparation\s*$/im.test(body)) errors.push('body is missing a "## Preparation" heading')

  for (const [lang, label] of [['nl', 'Dutch'], ['fr', 'French'], ['de', 'German']]) {
    if (!new RegExp(`^title_${lang}:\\s*\\S`, 'm').test(frontmatter)) warnings.push(`${label} title_${lang}`)
    if (!new RegExp(`^description_${lang}:\\s*\\S`, 'm').test(frontmatter)) warnings.push(`${label} description_${lang}`)
    if (!new RegExp(`^##\\s+ingredients\\s*\\(${lang}\\)\\s*$`, 'im').test(body)) warnings.push(`${label} "## Ingredients (${lang})"`)
    if (!new RegExp(`^##\\s+preparation\\s*\\(${lang}\\)\\s*$`, 'im').test(body)) warnings.push(`${label} "## Preparation (${lang})"`)
  }

  return { valid: errors.length === 0, errors, warnings }
}

// Every tool the local LLM can call, across all dev-only chat surfaces
// (recipe editor, fridge assistant, auto-tagging). `execute` always returns
// { ok, resultText, retryable?, extra? } — resultText becomes the `role:
// 'tool'` message fed back to the model (both on success and failure), and
// `extra` fields get merged into the JSON response sent to the browser.
const TOOL_REGISTRY = {
  save_recipe: {
    schema: {
      type: 'function',
      function: {
        name: 'save_recipe',
        description:
          "Save the finalized recipe to disk in the user's recipe collection. Only call this when the user explicitly asks to save, finalize, store, or add the recipe — not while still drafting or refining it.",
        parameters: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: "Lowercase kebab-case filename ending in .md, derived from the recipe title, e.g. 'chicken-fried-rice.md'.",
            },
            content: {
              type: 'string',
              description: 'The complete recipe markdown: frontmatter plus the Ingredients/Preparation sections (base + translations), in the exact required format.',
            },
          },
          required: ['filename', 'content'],
        },
      },
    },
    execute(args) {
      const filename = resolveFilename(args.filename, args.content)
      if (!filename) return { ok: false, resultText: 'Save failed: missing or invalid filename.', retryable: true }

      const { valid, errors, warnings } = validateRecipeMarkdown(args.content)
      if (!valid) {
        return { ok: false, resultText: `Save failed, fix and call save_recipe again: ${errors.join('; ')}`, retryable: true }
      }

      saveRecipe(filename, args.content)
      const warnNote = warnings.length ? ` (missing: ${warnings.join(', ')} — consider adding these too.)` : ''
      return {
        ok: true,
        resultText: `Saved as ${filename}.${warnNote}`,
        extra: { saved: { filename, content: args.content } },
      }
    },
  },

  update_fridge_items: {
    schema: {
      type: 'function',
      function: {
        name: 'update_fridge_items',
        description:
          "Replace the full fridge/pantry item list with an updated one, based on what the user said they added, bought, or used up. Always pass the COMPLETE current list, not just the changed items.",
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { type: 'string' },
              description: 'The complete, deduplicated list of ingredients currently available, normalized to short lowercase English names (e.g. "soy sauce", "chicken breast") regardless of what language the user wrote in.',
            },
          },
          required: ['items'],
        },
      },
    },
    execute(args) {
      if (!Array.isArray(args.items)) {
        return { ok: false, resultText: 'items must be an array of strings.', retryable: true }
      }
      const items = args.items.map(String).map((s) => s.trim()).filter(Boolean)
      saveFridge(items)
      return {
        ok: true,
        resultText: `Fridge updated: ${items.join(', ') || '(empty)'}`,
        extra: { fridge: { items } },
      }
    },
  },

  update_recipe_tags: {
    schema: {
      type: 'function',
      function: {
        name: 'update_recipe_tags',
        description: 'Set the tags for one existing recipe, replacing whatever tags it currently has.',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: 'The exact .md filename of the recipe to update, e.g. "chicken-fried-rice.md".' },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: '3-6 short lowercase kebab-case tags for this recipe.',
            },
          },
          required: ['filename', 'tags'],
        },
      },
    },
    execute(args) {
      if (!args.filename || !Array.isArray(args.tags)) {
        return { ok: false, resultText: 'filename and tags (array) are required.', retryable: true }
      }
      return updateRecipeTags(args.filename, args.tags)
    },
  },
}

function loadLlmConfig() {
  const configPath = path.join(ROOT, 'llm.config.json')
  // reasoningEffort/nativeOllama exist for hybrid-reasoning models (e.g.
  // qwen3.5) that think-by-default: over Ollama's OpenAI-compat endpoint,
  // `reasoning_effort: 'none'` suppresses that WHEN NO TOOLS ARE SENT, but
  // once `tools` are present (every request in this app) it's silently
  // ignored and the model can hang for minutes or return empty `content`
  // after burning its whole budget on invisible thinking. The one thing that
  // reliably works with tools is Ollama's *native* /api/chat with
  // `think: false` — set `nativeOllama: true` in llm.config.json to use it.
  // Harmless to leave both fields off for models without a "thinking" mode.
  const defaults = {
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    apiKey: 'ollama',
    reasoningEffort: 'none',
    nativeOllama: false,
  }
  if (!fs.existsSync(configPath)) return defaults
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) }
  } catch {
    return defaults
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

// Normalizes tool_calls' `arguments` — the OpenAI-compat endpoint returns it
// as a JSON *string*, Ollama's native /api/chat returns it already parsed as
// an *object*. JSON.parse-ing an object throws (silently swallowed by the
// caller's try/catch), which would make every native-mode tool call fail
// with empty args and nobody the wiser.
function parseToolArguments(rawArguments) {
  if (typeof rawArguments === 'string') {
    try {
      return JSON.parse(rawArguments)
    } catch {
      return {}
    }
  }
  return rawArguments && typeof rawArguments === 'object' ? rawArguments : {}
}

async function callLlm(llmConfig, messages, toolSchemas) {
  const { baseUrl, model, apiKey, reasoningEffort, nativeOllama } = llmConfig

  if (nativeOllama) {
    const nativeUrl = `${baseUrl.replace(/\/v1\/?$/, '')}/api/chat`
    const upstream = await fetch(nativeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        tools: toolSchemas,
        stream: false,
        ...(reasoningEffort === 'none' ? { think: false } : {}),
      }),
    })

    if (!upstream.ok) {
      const text = await upstream.text()
      throw new Error(`LLM server responded ${upstream.status}: ${text}`)
    }

    const data = await upstream.json()
    return data.message ?? { content: '' }
  }

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools: toolSchemas,
      tool_choice: 'auto',
      stream: false,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    }),
  })

  if (!upstream.ok) {
    const text = await upstream.text()
    throw new Error(`LLM server responded ${upstream.status}: ${text}`)
  }

  const data = await upstream.json()
  return data.choices?.[0]?.message ?? { content: '' }
}

// Dev-only API for the /editor and /fridge pages: lists/saves/deletes recipe
// markdown files, reads/writes the fridge inventory, and proxies chat
// requests (with tool-calling) to a local LLM so the browser never needs the
// LLM server's CORS config opened up. Registered via configureServer, which
// Vite only calls for `vite dev` — none of this ships in the production
// build served by GitHub Pages.
export function recipeEditorApi() {
  return {
    name: 'recipe-editor-api',
    configureServer(server) {
      server.middlewares.use('/api/recipes', async (req, res, next) => {
        try {
          if (req.method === 'GET') {
            const files = fs
              .readdirSync(RECIPES_DIR)
              .filter((f) => f.endsWith('.md'))
              .map((filename) => ({
                filename,
                raw: fs.readFileSync(path.join(RECIPES_DIR, filename), 'utf-8'),
              }))
            return sendJson(res, 200, { recipes: files })
          }

          if (req.method === 'POST') {
            const { filename, content } = await readJsonBody(req)
            if (!isSafeFilename(filename)) return sendJson(res, 400, { error: 'Invalid filename' })
            const { valid, errors, warnings } = validateRecipeMarkdown(content)
            if (!valid) return sendJson(res, 400, { error: `Recipe format issue: ${errors.join('; ')}` })
            saveRecipe(filename, content)
            return sendJson(res, 200, { ok: true, warnings })
          }

          if (req.method === 'DELETE') {
            const { filename } = await readJsonBody(req)
            if (!isSafeFilename(filename)) return sendJson(res, 400, { error: 'Invalid filename' })
            const target = path.join(RECIPES_DIR, filename)
            if (fs.existsSync(target)) fs.unlinkSync(target)
            return sendJson(res, 200, { ok: true })
          }

          next()
        } catch (err) {
          sendJson(res, 500, { error: err.message })
        }
      })

      server.middlewares.use('/api/fridge', async (req, res, next) => {
        try {
          if (req.method === 'GET') {
            return sendJson(res, 200, loadFridge())
          }

          if (req.method === 'POST') {
            const { items } = await readJsonBody(req)
            if (!Array.isArray(items)) return sendJson(res, 400, { error: 'items must be an array' })
            const clean = items.map(String).map((s) => s.trim()).filter(Boolean)
            saveFridge(clean)
            return sendJson(res, 200, { ok: true, items: clean })
          }

          next()
        } catch (err) {
          sendJson(res, 500, { error: err.message })
        }
      })

      server.middlewares.use('/api/preferences', async (req, res, next) => {
        try {
          if (req.method === 'GET') {
            return sendJson(res, 200, { text: loadPreferences() })
          }

          if (req.method === 'POST') {
            const { text } = await readJsonBody(req)
            if (typeof text !== 'string') return sendJson(res, 400, { error: 'text must be a string' })
            savePreferencesText(text)
            return sendJson(res, 200, { ok: true })
          }

          next()
        } catch (err) {
          sendJson(res, 500, { error: err.message })
        }
      })

      server.middlewares.use('/api/llm/chat', async (req, res, next) => {
        if (req.method !== 'POST') return next()

        try {
          const { messages, tools: toolNames = ['save_recipe'] } = await readJsonBody(req)
          const llmConfig = loadLlmConfig()

          const activeTools = toolNames.map((name) => TOOL_REGISTRY[name]).filter(Boolean)
          const toolSchemas = activeTools.map((t) => t.schema)

          let conversation = messages
          let extra = {}
          const MAX_ATTEMPTS = 3

          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const message = await callLlm(llmConfig, conversation, toolSchemas)
            const call = message.tool_calls?.find((c) => TOOL_REGISTRY[c.function?.name])

            if (!call) {
              return sendJson(res, 200, { reply: message.content ?? '', ...extra })
            }

            const args = parseToolArguments(call.function.arguments)
            const result = TOOL_REGISTRY[call.function.name].execute(args)
            if (result.extra) extra = { ...extra, ...result.extra }

            if (result.ok) {
              const followUpMessages = [
                ...conversation,
                message,
                { role: 'tool', tool_call_id: call.id, content: result.resultText },
              ]
              const followUp = await callLlm(llmConfig, followUpMessages, toolSchemas)
              return sendJson(res, 200, { reply: followUp.content ?? result.resultText, ...extra })
            }

            if (attempt === MAX_ATTEMPTS) {
              return sendJson(res, 200, {
                reply: `I couldn't complete this after a few tries (${result.resultText}). You may need to do it manually.`,
                ...extra,
              })
            }

            conversation = [
              ...conversation,
              message,
              { role: 'tool', tool_call_id: call.id, content: result.resultText },
            ]
          }
        } catch (err) {
          sendJson(res, 502, {
            error: `Could not reach local LLM at the configured baseUrl. Is it running? (${err.message})`,
          })
        }
      })
    },
  }
}
