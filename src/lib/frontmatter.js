// Minimal YAML-ish frontmatter parser — supports the small subset of YAML
// needed for recipe metadata (strings, numbers, and flow/block string arrays).
// Avoids pulling in a full YAML parser (and its Node/Buffer polyfills) just
// for a handful of flat key/value pairs.
export function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { data: {}, content: raw }

  const [, block, content] = match
  const data = {}
  const lines = block.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue

    const kv = line.match(/^([^:]+):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1].trim()
    let value = kv[2].trim()

    if (value === '') {
      // Possible block list on following indented "- item" lines
      const items = []
      let j = i + 1
      while (j < lines.length && /^\s*-\s*/.test(lines[j])) {
        items.push(stripQuotes(lines[j].replace(/^\s*-\s*/, '').trim()))
        j++
      }
      if (items.length) {
        data[key] = items
        i = j - 1
        continue
      }
      data[key] = ''
    } else if (/^\[.*\]$/.test(value)) {
      // Flow list: [a, b, c]
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((v) => stripQuotes(v.trim()))
        .filter(Boolean)
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      data[key] = Number(value)
    } else if (value === 'true' || value === 'false') {
      data[key] = value === 'true'
    } else {
      data[key] = stripQuotes(value)
    }
  }

  return { data, content: content.replace(/^\r?\n/, '') }
}

function stripQuotes(str) {
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    return str.slice(1, -1)
  }
  return str
}
