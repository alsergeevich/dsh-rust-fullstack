import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseSkillMarkdown, validatePackIndex } from '../lib/skill-store.js'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SKILL_DIR = path.join(ROOT, 'skill')
const INDEX_FILE = path.join(SKILL_DIR, 'skill-index.json')
const EXCLUDED = new Set(['skill-index.json', 'versions.json', 'versions.md'])
const REQUIRED = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/tools.js',
  'skill/SKILL.md',
  'skill/sources.md',
  'locale/en.json',
  'locale/ru.json',
  'icon.svg',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'docs/DETAIL.md',
  'docs/DETAIL.ru.md',
]

const errors = []
function fail(message) {
  errors.push(message)
}

async function walk(dir, prefix = '') {
  const out = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

for (const rel of REQUIRED) {
  try {
    const stat = await fs.stat(path.join(ROOT, rel))
    if (!stat.isFile() || stat.size === 0) fail(`missing or empty: ${rel}`)
  } catch {
    fail(`missing: ${rel}`)
  }
}

const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'))
if (!pkg.dsh?.bundle?.patch) fail('package.json is missing dsh.bundle.patch')
if (!pkg.exports?.['./icon']) fail('package.json is missing exports["./icon"]')
if (!pkg.exports?.['./locale/*.json']) fail('package.json is missing exports["./locale/*.json"]')
if (!Array.isArray(pkg.files)) fail('package.json is missing files[]')
else {
  for (const rel of ['lib', 'skill', 'locale', 'docs', 'icon.svg', 'cordis.patch.yml', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
    if (!pkg.files.includes(rel)) fail(`package.json files[] is missing ${rel}`)
  }
}

const skillText = await fs.readFile(path.join(SKILL_DIR, 'SKILL.md'), 'utf8')
const parsed = parseSkillMarkdown(skillText)
if (parsed.meta.name !== 'rust-fullstack-elite') fail('SKILL.md name must be rust-fullstack-elite')
if (!parsed.meta.description) fail('SKILL.md description is required')
if (parsed.meta.metadata?.version !== pkg.version) {
  fail(`SKILL.md metadata.version (${parsed.meta.metadata?.version}) must equal package version (${pkg.version})`)
}

let index
try {
  index = JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'))
} catch {
  fail('skill/skill-index.json is missing or invalid; run npm run build:index')
}

if (index) {
  const validation = validatePackIndex(index)
  if (!validation.ok) for (const error of validation.errors) fail(`skill-index: ${error}`)
  const indexed = new Map(index.files.map((entry) => [entry.path, entry]))
  const files = (await walk(SKILL_DIR)).filter((rel) => !EXCLUDED.has(rel))
  for (const rel of files) {
    const entry = indexed.get(rel)
    if (!entry) {
      fail(`skill-index is missing ${rel}; run npm run build:index`)
      continue
    }
    const data = await fs.readFile(path.join(SKILL_DIR, rel))
    const hash = crypto.createHash('sha256').update(data).digest('hex')
    if (entry.sha256 !== hash) fail(`skill-index hash mismatch: ${rel}`)
    if (entry.bytes !== data.length) fail(`skill-index size mismatch: ${rel}`)
  }
  for (const rel of indexed.keys()) {
    if (!files.includes(rel)) fail(`skill-index contains extra file: ${rel}`)
  }
}

const libFiles = (await walk(path.join(ROOT, 'lib'))).filter((rel) => rel.endsWith('.js'))
for (const rel of libFiles) {
  const source = await fs.readFile(path.join(ROOT, 'lib', rel), 'utf8')
  if (/from\s+['"]@deepseek-ai\//.test(source) || /import\(\s*['"]@deepseek-ai\//.test(source)) {
    fail(`lib/${rel} must not import DSH runtime packages`)
  }
}

for (const rel of libFiles) {
  try {
    await import(pathToFileURL(path.join(ROOT, 'lib', rel)).href)
  } catch (error) {
    fail(`lib/${rel} failed to import: ${error.message}`)
  }
}

if (errors.length) {
  console.error('Validation failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`Validation passed: plugin ${pkg.name}@${pkg.version}, ${index.files.length} skill files.`)
}
