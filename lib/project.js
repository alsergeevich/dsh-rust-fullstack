import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

const IGNORED_DIRS = new Set(['.git', 'target', 'node_modules', 'dist', 'build', '.dsh', '.next', 'coverage'])
const CACHE_TTL_MS = 30_000
const cache = new Map()

function existsSync(target) {
  try {
    fsSync.accessSync(target)
    return true
  } catch {
    return false
  }
}

async function readTextLimited(file, maxBytes = 2 * 1024 * 1024) {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > maxBytes) return null
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

function unquote(value) {
  const match = /^"((?:[^"\\]|\\.)*)"/.exec(String(value).trim())
  if (!match) return null
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function parseArray(value) {
  const match = /\[([\s\S]*?)\]/.exec(String(value || ''))
  if (!match) return []
  return match[1]
    .split(',')
    .map((item) => unquote(item.trim()) || item.trim().replace(/^'|'$/g, ''))
    .filter((item) => item && !item.startsWith('#'))
}

function parseSections(text) {
  const sections = new Map()
  let current = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      current = header[1].trim()
      if (!sections.has(current)) sections.set(current, new Map())
      continue
    }
    if (!current) continue
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line)
    if (kv) sections.get(current).set(kv[1], kv[2])
  }
  return sections
}

function workspaceMembersFromText(text) {
  const workspace = /\[workspace\]([\s\S]*?)(?=\n\[|$)/.exec(text)
  if (!workspace) return []
  const members = /members\s*=\s*\[([\s\S]*?)\]/.exec(workspace[1])
  return members ? parseArray(`[${members[1]}]`) : []
}

function parseCargoLock(text) {
  const versions = {}
  if (!text) return versions
  const blocks = text.matchAll(/\[\[package\]\]\s*\n([\s\S]*?)(?=\n\[\[package\]\]|$)/g)
  for (const block of blocks) {
    const body = block[1]
    const name = /^name\s*=\s*"([^"]+)"/m.exec(body)
    const version = /^version\s*=\s*"([^"]+)"/m.exec(body)
    if (name && version && !(name[1] in versions)) versions[name[1]] = version[1]
  }
  return versions
}

async function countRustFiles(root, maxFiles = 2000) {
  let count = 0
  const limit = Math.max(1, Math.min(5000, Number(maxFiles) || 2000))
  async function walk(dir, depth) {
    if (depth > 4 || count >= limit) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (count >= limit) return
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(target, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.rs')) count += 1
    }
  }
  await walk(root, 0)
  return count
}

export function findCargoRoot(cwd) {
  if (!cwd) return null
  let dir = path.resolve(cwd)
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(dir, 'Cargo.toml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function isIgnoredPath(filePath) {
  if (!filePath) return false
  const parts = String(filePath).split(/[\\/]+/).map((part) => part.toLowerCase())
  return parts.some((part) => IGNORED_DIRS.has(part))
}

export function detectLanguageFromPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase()
  if (ext === '.rs') return 'rust'
  if (ext === '.toml') return 'toml'
  if (ext === '.ts' || ext === '.tsx') return 'typescript'
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript'
  if (ext === '.py') return 'python'
  if (ext === '.go') return 'go'
  if (ext === '.sql') return 'sql'
  return null
}

export async function scanProject(cwd, options = {}) {
  const key = path.resolve(cwd || process.cwd())
  const cached = cache.get(key)
  if (!options.fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value

  const root = findCargoRoot(key)
  if (!root) {
    const value = {
      ok: true,
      hasCargo: false,
      cwd: key,
      root: null,
      scannedAt: new Date().toISOString(),
      warnings: [],
    }
    cache.set(key, { at: Date.now(), value })
    return value
  }

  const warnings = []
  const manifest = await readTextLimited(path.join(root, 'Cargo.toml'))
  if (manifest === null) {
    const value = {
      ok: true,
      hasCargo: false,
      cwd: key,
      root,
      scannedAt: new Date().toISOString(),
      warnings: ['Cargo.toml exists but could not be read'],
    }
    cache.set(key, { at: Date.now(), value })
    return value
  }

  const sections = parseSections(manifest)
  const pkg = sections.get('package') || new Map()
  const workspace = sections.get('workspace') || new Map()
  const packageName = unquote(pkg.get('name')) || null
  const edition = unquote(pkg.get('edition')) || unquote(workspace.get('edition')) || null
  const rustVersion = unquote(pkg.get('rust-version')) || unquote(workspace.get('rust-version')) || null
  const workspaceMembers = workspaceMembersFromText(manifest)

  const deps = new Map()
  for (const [section, values] of sections) {
    if (/(^|\.)(dependencies|dev-dependencies|build-dependencies)$/.test(section)) {
      for (const [name, raw] of values) deps.set(name, raw)
    }
  }

  const featureNames = new Set(sections.has('features') ? sections.get('features').keys() : [])

  const frameworks = []
  const frameworkNames = [
    ['axum', 'axum'],
    ['leptos', 'leptos'],
    ['dioxus', 'dioxus'],
    ['sqlx', 'sqlx'],
    ['tokio', 'tokio'],
    ['tower-http', 'tower-http'],
    ['diesel', 'diesel'],
    ['sea-orm', 'sea-orm'],
    ['actix-web', 'actix-web'],
  ]
  for (const [dep, label] of frameworkNames) {
    if (deps.has(dep) || featureNames.has(dep)) frameworks.push(label)
  }

  const databases = new Set()
  const sqlxRaw = deps.get('sqlx') || ''
  const sqlxFeatures = parseArray(/features\s*=\s*(\[[\s\S]*?\])/.exec(sqlxRaw)?.[1] || '')
  for (const feature of sqlxFeatures) {
    const lower = feature.toLowerCase()
    if (lower === 'postgres' || lower === 'postgresql') databases.add('postgresql')
    if (lower === 'sqlite') databases.add('sqlite')
    if (lower === 'mysql') databases.add('mysql')
  }
  if (deps.has('tokio-postgres') || deps.has('postgres') || deps.has('deadpool-postgres')) databases.add('postgresql')
  if (deps.has('rusqlite') || deps.has('sqlite') || deps.has('libsqlite3-sys')) databases.add('sqlite')
  for (const feature of featureNames) {
    const lower = feature.toLowerCase()
    if (lower.includes('postgres')) databases.add('postgresql')
    if (lower.includes('sqlite')) databases.add('sqlite')
  }

  const lockText = await readTextLimited(path.join(root, 'Cargo.lock'), 8 * 1024 * 1024)
  const lockVersions = parseCargoLock(lockText || '')
  if (lockText === null && deps.size > 0) warnings.push('Cargo.lock is missing; dependency versions are not pinned')

  const interesting = ['axum', 'leptos', 'dioxus', 'sqlx', 'tokio', 'tower-http', 'serde', 'thiserror', 'anyhow', 'argon2', 'rustls', 'tower']
  const versions = {}
  for (const name of interesting) {
    if (lockVersions[name]) versions[name] = lockVersions[name]
  }

  let toolchain = null
  const toolchainToml = await readTextLimited(path.join(root, 'rust-toolchain.toml'))
  if (toolchainToml) {
    const channel = /^\s*channel\s*=\s*"([^"]+)"/m.exec(toolchainToml)
    if (channel) toolchain = channel[1]
  }
  if (!toolchain) {
    const plain = await readTextLimited(path.join(root, 'rust-toolchain'))
    if (plain) toolchain = plain.trim().split(/\r?\n/)[0] || null
  }

  const migrations =
    existsSync(path.join(root, 'migrations')) ||
    existsSync(path.join(root, 'sqlx-data.json')) ||
    existsSync(path.join(root, '.sqlx'))

  const rustFileCount = await countRustFiles(root, options.maxFiles)
  const value = {
    ok: true,
    hasCargo: true,
    cwd: key,
    root,
    packageName,
    workspace: workspaceMembers.length > 0 ? workspaceMembers : false,
    workspaceMembers,
    edition,
    rustVersion,
    toolchain,
    frameworks,
    databases: [...databases],
    versions,
    migrations,
    rustFileCount,
    scannedAt: new Date().toISOString(),
    warnings,
  }
  cache.set(key, { at: Date.now(), value })
  return value
}

export function clearProjectCache() {
  cache.clear()
}
