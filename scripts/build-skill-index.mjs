import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSkillMarkdown } from '../lib/skill-store.js'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SKILL_DIR = path.join(ROOT, 'skill')
const INDEX_FILE = path.join(SKILL_DIR, 'skill-index.json')
const EXCLUDED = new Set(['skill-index.json', 'versions.json', 'versions.md'])

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

export async function buildSkillIndex({ write = true } = {}) {
  const skillText = await fs.readFile(path.join(SKILL_DIR, 'SKILL.md'), 'utf8')
  const parsed = parseSkillMarkdown(skillText)
  const skillVersion = parsed.meta?.metadata?.version || parsed.meta?.version || '0.1.0'
  const pack = parsed.meta?.metadata?.pack || `v${skillVersion}`
  const files = (await walk(SKILL_DIR)).filter((rel) => !EXCLUDED.has(rel)).sort()
  const entries = []
  for (const rel of files) {
    const data = await fs.readFile(path.join(SKILL_DIR, rel))
    entries.push({
      path: rel,
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    })
  }
  const index = {
    schemaVersion: 1,
    skillVersion,
    pack,
    generatedAt: new Date().toISOString(),
    files: entries,
  }
  if (write) {
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + '\n')
  }
  return index
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = await buildSkillIndex()
  console.log(`Wrote skill-index.json: ${index.files.length} files, skill version ${index.skillVersion}`)
}
