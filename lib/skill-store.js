import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKAGE_VERSION } from './config.js'
import { fetchJson, fetchText } from './http.js'

const BUNDLED_SKILL_DIR = fileURLToPath(new URL('../skill/', import.meta.url))
const GENERATED_FILES = new Set(['versions.json', 'versions.md'])
const MANIFEST_NAME = '.dsh-rust-fullstack.json'
const MAX_PACK_FILES = 200
const MAX_PACK_FILE_BYTES = 512 * 1024
const MAX_PACK_TOTAL_BYTES = 8 * 1024 * 1024

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function storePaths(env = process.env) {
  const home = env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const dataDir = path.join(home, 'rust-fullstack')
  return {
    home,
    dataDir,
    globalSkillDir: path.join(home, 'skills', 'rust-fullstack-elite'),
    cacheDir: path.join(dataDir, 'cache', 'docs'),
    backupDir: path.join(dataDir, 'backups'),
    stagingDir: path.join(dataDir, 'staging'),
    statePath: path.join(dataDir, 'state.json'),
  }
}

export function bundledSkillDir() {
  return BUNDLED_SKILL_DIR
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export async function sha256File(file) {
  const data = await fs.readFile(file)
  return sha256(data)
}

async function fileExists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function atomicWriteFile(file, data) {
  await ensureDir(path.dirname(file))
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  await fs.writeFile(tmp, data)
  try {
    await fs.rename(tmp, file)
  } catch {
    await fs.rm(file, { force: true })
    await fs.rename(tmp, file)
  }
}

async function listFiles(root, prefix = '') {
  const out = []
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(full, rel)))
    else if (entry.isFile()) out.push(rel)
  }
  return out.sort()
}

export function parseSkillMarkdown(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(text || ''))
  const meta = {}
  let section = null
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const nested = /^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
      if (nested && section) {
        meta[section] = meta[section] && typeof meta[section] === 'object' ? meta[section] : {}
        meta[section][nested[1]] = stripQuotes(nested[2].trim())
        continue
      }
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
      if (!kv) continue
      section = null
      const value = stripQuotes(kv[2].trim())
      if (!value) {
        meta[kv[1]] = {}
        section = kv[1]
      } else {
        meta[kv[1]] = value
      }
    }
  }
  const body = match ? String(text).slice(match[0].length).trim() : String(text || '').trim()
  return { meta, body }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}


export async function readSkillFromDir(dir) {
  const file = path.join(dir, 'SKILL.md')
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
  const parsed = parseSkillMarkdown(text)
  return {
    name: parsed.meta.name || path.basename(dir),
    description: parsed.meta.description || '',
    whenToUse: parsed.meta.whenToUse || undefined,
    content: parsed.body,
    path: file,
    provider: 'filesystem',
    resourceBase: { kind: 'directory', path: dir },
    meta: parsed.meta,
  }
}

export async function loadSkill({ ctx, agent, cwd, skillName, signal, globalDir = storePaths().globalSkillDir }) {
  if (ctx?.skills?.get) {
    try {
      const found = await ctx.skills.get(skillName, { cwd, signal, scope: agent })
      if (found) {
        return {
          ...found,
          content: found.content || '',
          resourceBase: found.resourceBase,
        }
      }
    } catch {
      // fall through to filesystem copies
    }
  }
  const global = await readSkillFromDir(globalDir)
  if (global) return global
  return readSkillFromDir(BUNDLED_SKILL_DIR)
}

export async function readManifest(targetDir) {
  try {
    const raw = await fs.readFile(path.join(targetDir, MANIFEST_NAME), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

async function backupTarget(targetDir, backupRoot) {
  if (!backupRoot) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(backupRoot, stamp)
  await ensureDir(backup)
  for (const rel of await listFiles(targetDir)) {
    const from = path.join(targetDir, rel)
    const to = path.join(backup, rel)
    await ensureDir(path.dirname(to))
    await fs.copyFile(from, to)
  }
  return backup
}

function sourceHashes(files, contents) {
  const hashes = {}
  for (const rel of files) hashes[rel] = sha256(contents.get(rel))
  return hashes
}

export async function ensureGlobalSkill({
  sourceDir = BUNDLED_SKILL_DIR,
  targetDir = storePaths().globalSkillDir,
  backupRoot = storePaths().backupDir,
  force = false,
  logger = console,
} = {}) {
  const result = {
    ok: true,
    targetDir,
    installed: [],
    updated: [],
    skippedUserModified: [],
    errors: [],
    backupPath: null,
  }
  const sourceFiles = await listFiles(sourceDir)
  if (!sourceFiles.length) {
    return { ...result, ok: false, errors: ['bundled skill directory is empty'] }
  }
  const contents = new Map()
  for (const rel of sourceFiles) {
    contents.set(rel, await fs.readFile(path.join(sourceDir, rel)))
  }

  await ensureDir(targetDir)
  const manifest = await readManifest(targetDir)
  if (force && (manifest || (await fileExists(path.join(targetDir, 'SKILL.md'))))) {
    result.backupPath = await backupTarget(targetDir, backupRoot)
  }

  for (const rel of sourceFiles) {
    const target = path.join(targetDir, rel)
    const sourceContent = contents.get(rel)
    const sourceHash = sha256(sourceContent)
    const generated = GENERATED_FILES.has(rel)
    try {
      const exists = await fileExists(target)
      if (!exists) {
        await atomicWriteFile(target, sourceContent)
        result.installed.push(rel)
        continue
      }
      const currentHash = await sha256File(target)
      if (force || generated) {
        if (currentHash !== sourceHash) {
          await atomicWriteFile(target, sourceContent)
          result.updated.push(rel)
        }
        continue
      }
      const previousHash = manifest?.files?.[rel]
      if (!manifest || previousHash === undefined) {
        result.skippedUserModified.push(rel)
        continue
      }
      if (previousHash === currentHash) {
        if (currentHash !== sourceHash) {
          await atomicWriteFile(target, sourceContent)
          result.updated.push(rel)
        }
        continue
      }
      result.skippedUserModified.push(rel)
    } catch (error) {
      result.errors.push(`${rel}: ${error.message}`)
    }
  }

  const skill = await readSkillFromDir(targetDir)
  const nextManifest = {
    schemaVersion: 1,
    pluginVersion: PACKAGE_VERSION,
    skillVersion: skill?.meta?.metadata?.version || skill?.meta?.version || '0.1.0',
    skillPack: skill?.meta?.metadata?.pack || skill?.meta?.pack || null,
    installedAt: manifest?.installedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    files: sourceHashes(sourceFiles, contents),
  }
  try {
    await atomicWriteFile(path.join(targetDir, MANIFEST_NAME), JSON.stringify(nextManifest, null, 2) + '\n')
  } catch (error) {
    result.errors.push(`${MANIFEST_NAME}: ${error.message}`)
  }
  result.ok = result.errors.length === 0
  if (!result.ok) logger?.warn?.('[rust-fullstack] global skill install had errors', result.errors)
  return result
}

export async function globalSkillStatus({ targetDir = storePaths().globalSkillDir } = {}) {
  const manifest = await readManifest(targetDir)
  const exists = await fileExists(path.join(targetDir, 'SKILL.md'))
  const userModified = []
  const missing = []
  const extra = []
  if (manifest?.files) {
    for (const [rel, expected] of Object.entries(manifest.files)) {
      const file = path.join(targetDir, rel)
      if (!(await fileExists(file))) {
        missing.push(rel)
        continue
      }
      const actual = await sha256File(file)
      if (actual !== expected) userModified.push(rel)
    }
    const current = await listFiles(targetDir)
    for (const rel of current) {
      if (rel === MANIFEST_NAME || GENERATED_FILES.has(rel)) continue
      if (!(rel in manifest.files)) extra.push(rel)
    }
  }
  const skill = exists ? await readSkillFromDir(targetDir) : null
  return {
    ok: true,
    path: targetDir,
    exists,
    manifest,
    skillVersion: manifest?.skillVersion || skill?.meta?.metadata?.version || skill?.meta?.version || null,
    skillPack: manifest?.skillPack || skill?.meta?.metadata?.pack || skill?.meta?.pack || null,
    userModified,
    missing,
    extra,
  }
}

export function validatePackIndex(index) {
  const errors = []
  if (!index || typeof index !== 'object') return { ok: false, errors: ['index is not an object'] }
  if (index.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (typeof index.skillVersion !== 'string' || !index.skillVersion) errors.push('skillVersion is required')
  if (!Array.isArray(index.files) || index.files.length === 0) errors.push('files must be a non-empty array')
  if (Array.isArray(index.files) && index.files.length > MAX_PACK_FILES) errors.push(`files exceeds ${MAX_PACK_FILES}`)
  let total = 0
  const seen = new Set()
  for (const file of Array.isArray(index.files) ? index.files : []) {
    if (!file || typeof file !== 'object') {
      errors.push('file entry is invalid')
      continue
    }
    const rel = String(file.path || '')
    if (
      !rel ||
      rel.startsWith('/') ||
      rel.includes('\\') ||
      rel.includes('..') ||
      rel.includes(':') ||
      /[\u0000-\u001f]/.test(rel)
    ) {
      errors.push(`unsafe path: ${rel}`)
    }
    if (seen.has(rel)) errors.push(`duplicate path: ${rel}`)
    seen.add(rel)
    if (!/^[a-f0-9]{64}$/i.test(String(file.sha256 || ''))) errors.push(`bad sha256: ${rel}`)
    const bytes = Number(file.bytes)
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_PACK_FILE_BYTES) errors.push(`bad size: ${rel}`)
    total += Number.isFinite(bytes) ? bytes : 0
  }
  if (total > MAX_PACK_TOTAL_BYTES) errors.push('pack exceeds total size limit')
  if (!seen.has('SKILL.md')) errors.push('SKILL.md is required')
  return { ok: errors.length === 0, errors }
}

async function latestReleaseTag(repo, { fetchImpl, signal, timeoutMs = 12000 } = {}) {
  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`, {
    fetchImpl,
    signal,
    timeoutMs,
    headers: { accept: 'application/vnd.github+json' },
  })
  if (!release?.tag_name) throw new Error('latest release has no tag_name')
  return { tag: release.tag_name, release }
}

export async function getLatestPluginRelease(repo, options = {}) {
  const { tag, release } = await latestReleaseTag(repo, options)
  return {
    tag,
    name: release.name || tag,
    htmlUrl: release.html_url || `https://github.com/${repo}/releases/tag/${tag}`,
    publishedAt: release.published_at || null,
    tarball: release.tarball_url || null,
    body: release.body || '',
  }
}

export async function downloadPack({ repo, ref, fetchImpl, signal, timeoutMs = 12000 } = {}) {
  const resolved = ref || (await latestReleaseTag(repo, { fetchImpl, signal, timeoutMs })).tag
  const tag = String(resolved)
  const base = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(tag)}/skill/`
  const indexResult = await fetchText(`${base}skill-index.json`, {
    fetchImpl,
    signal,
    timeoutMs,
    maxBytes: 256 * 1024,
  })
  if (!indexResult.ok) throw new Error(`skill-index.json: HTTP ${indexResult.status}`)
  let index
  try {
    index = JSON.parse(indexResult.text)
  } catch {
    throw new Error('skill-index.json is not valid JSON')
  }
  const validation = validatePackIndex(index)
  if (!validation.ok) throw new Error(`invalid skill pack: ${validation.errors.join('; ')}`)

  const files = new Map()
  for (const entry of index.files) {
    const result = await fetchText(`${base}${entry.path.split('/').map(encodeURIComponent).join('/')}`, {
      fetchImpl,
      signal,
      timeoutMs,
      maxBytes: MAX_PACK_FILE_BYTES,
    })
    if (!result.ok) throw new Error(`${entry.path}: HTTP ${result.status}`)
    const data = Buffer.from(result.text, 'utf8')
    const hash = sha256(data)
    if (hash !== entry.sha256) throw new Error(`${entry.path}: sha256 mismatch`)
    files.set(entry.path, data)
  }
  return { tag, index, files }
}

export async function applyPack({
  pack,
  targetDir = storePaths().globalSkillDir,
  backupRoot = storePaths().backupDir,
  force = false,
} = {}) {
  const validation = validatePackIndex(pack?.index)
  if (!validation.ok) throw new Error(`invalid pack: ${validation.errors.join('; ')}`)
  const manifest = await readManifest(targetDir)
  const backupPath = await backupTarget(targetDir, backupRoot)
  const result = {
    ok: true,
    targetDir,
    tag: pack.tag,
    skillVersion: pack.index.skillVersion,
    applied: [],
    skippedUserModified: [],
    backupPath,
    errors: [],
  }
  await ensureDir(targetDir)
  for (const entry of pack.index.files) {
    const rel = entry.path
    const target = path.join(targetDir, rel)
    const content = pack.files.get(rel)
    if (!content) {
      result.errors.push(`${rel}: missing from pack`)
      continue
    }
    try {
      const exists = await fileExists(target)
      if (exists && !force) {
        const currentHash = await sha256File(target)
        const previousHash = manifest?.files?.[rel]
        if (previousHash === undefined) {
          result.skippedUserModified.push(rel)
          continue
        }
        if (currentHash !== previousHash) {
          result.skippedUserModified.push(rel)
          continue
        }
      }
      await atomicWriteFile(target, content)
      result.applied.push(rel)
    } catch (error) {
      result.errors.push(`${rel}: ${error.message}`)
    }
  }
  const nextManifest = {
    schemaVersion: 1,
    pluginVersion: PACKAGE_VERSION,
    skillVersion: pack.index.skillVersion,
    skillPack: pack.tag,
    installedAt: manifest?.installedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    files: Object.fromEntries(
      pack.index.files.map((entry) => [entry.path, entry.sha256]),
    ),
  }
  try {
    await atomicWriteFile(path.join(targetDir, MANIFEST_NAME), JSON.stringify(nextManifest, null, 2) + '\n')
  } catch (error) {
    result.errors.push(`${MANIFEST_NAME}: ${error.message}`)
  }
  result.ok = result.errors.length === 0
  return result
}

export async function updateSkill({
  cfg,
  ref,
  force = false,
  fetchImpl,
  signal,
  targetDir = storePaths().globalSkillDir,
} = {}) {
  const pack = await downloadPack({ repo: cfg.githubRepo, ref, fetchImpl, signal })
  return applyPack({ pack, targetDir, force })
}

export async function updateGeneratedFiles(skillDir, versions) {
  const json = JSON.stringify(versions, null, 2) + '\n'
  await atomicWriteFile(path.join(skillDir, 'versions.json'), json)
  const markerStart = '<!-- BEGIN AUTOGENERATED VERSIONS -->'
  const markerEnd = '<!-- END AUTOGENERATED VERSIONS -->'
  const file = path.join(skillDir, 'versions.md')
  let current = ''
  try {
    current = await fs.readFile(file, 'utf8')
  } catch {
    current = `# Version baseline\n\n${markerStart}\n${markerEnd}\n`
  }
  const table = versionsTable(versions)
  const next = current.includes(markerStart) && current.includes(markerEnd)
    ? current.replace(
        new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`),
        `${markerStart}\n${table}\n${markerEnd}`,
      )
    : `${current.trim()}\n\n${markerStart}\n${table}\n${markerEnd}\n`
  await atomicWriteFile(file, next)
  return { jsonPath: path.join(skillDir, 'versions.json'), mdPath: file }
}

export function versionsTable(versions) {
  const rows = [
    '| Technology | Latest | MSRV | Notes |',
    '|---|---:|---:|---|',
  ]
  for (const item of versions?.items || []) {
    rows.push(`| ${item.label} | ${item.version || '?'} | ${item.msrv || '—'} | ${item.note || ''} |`)
  }
  rows.push('')
  rows.push(`Checked: ${versions?.checkedAt || 'never'}`)
  return rows.join('\n')
}

export function isGeneratedFile(rel) {
  return GENERATED_FILES.has(rel)
}

export function pathExists(target) {
  return fsSync.existsSync(target)
}

export function globalSkillDirFor(cfg) {
  return path.join(dshHome(), 'skills', cfg?.skillName || 'rust-fullstack-elite')
}
