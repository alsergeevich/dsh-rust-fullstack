import fs from 'node:fs/promises'
import path from 'node:path'
import { fetchJson, fetchText, isAbortError } from './http.js'
import { updateGeneratedFiles } from './skill-store.js'

const CRATES = [
  ['axum', 'Axum', 'https://crates.io/crates/axum'],
  ['leptos', 'Leptos', 'https://crates.io/crates/leptos'],
  ['dioxus', 'Dioxus', 'https://crates.io/crates/dioxus'],
  ['sqlx', 'SQLx', 'https://crates.io/crates/sqlx'],
  ['tokio', 'Tokio', 'https://crates.io/crates/tokio'],
  ['tower-http', 'Tower-HTTP', 'https://crates.io/crates/tower-http'],
  ['cargo-leptos', 'cargo-leptos', 'https://crates.io/crates/cargo-leptos'],
  ['trunk', 'Trunk', 'https://crates.io/crates/trunk'],
  ['dioxus-cli', 'Dioxus CLI', 'https://crates.io/crates/dioxus-cli'],
  ['sqlx-cli', 'SQLx CLI', 'https://crates.io/crates/sqlx-cli'],
]

export const DOC_SOURCES = [
  ['docs:rust', 'Rust Book', 'https://doc.rust-lang.org/book/'],
  ['docs:axum', 'Axum docs', 'https://docs.rs/axum/latest/axum/'],
  ['docs:leptos', 'Leptos Book', 'https://book.leptos.dev/'],
  ['docs:dioxus', 'Dioxus docs', 'https://dioxuslabs.com/learn/0.7/'],
  ['docs:sqlx', 'SQLx docs', 'https://docs.rs/sqlx/latest/sqlx/'],
  ['docs:postgres', 'PostgreSQL docs', 'https://www.postgresql.org/docs/current/'],
  ['docs:sqlite', 'SQLite docs', 'https://www.sqlite.org/docs.html'],
]

const TECH_IDS = [
  'rust',
  ...CRATES.map(([name]) => `crates:${name}`),
  'postgres',
  'sqlite',
]

function sourceDefs(includeDocs) {
  const defs = [
    {
      id: 'rust',
      label: 'Rust stable',
      kind: 'tech',
      url: 'https://api.github.com/repos/rust-lang/rust/releases/latest',
      parse: (data) => {
        const tag = String(data?.tag_name || '').replace(/^v/, '')
        return {
          version: tag || null,
          date: data?.published_at || null,
          url: data?.html_url || 'https://github.com/rust-lang/rust/releases',
          note: 'stable release',
        }
      },
    },
    ...CRATES.map(([name, label, url]) => ({
      id: `crates:${name}`,
      label,
      kind: 'tech',
      url: `https://crates.io/api/v1/crates/${name}`,
      parse: (data) => parseCrate(data, name, url),
    })),
    {
      id: 'postgres',
      label: 'PostgreSQL',
      kind: 'tech',
      url: 'https://www.postgresql.org/versions.json',
      parse: parsePostgres,
    },
    {
      id: 'sqlite',
      label: 'SQLite',
      kind: 'tech',
      url: 'https://www.sqlite.org/download.html',
      parse: parseSqlite,
    },
  ]
  if (includeDocs) {
    for (const [id, label, url] of DOC_SOURCES) {
      defs.push({
        id,
        label,
        kind: 'docs',
        url,
        parse: (_data, response) => ({
          version: response.ok ? 'reachable' : `HTTP ${response.status}`,
          status: response.ok ? 'ok' : 'error',
          url,
          note: 'official documentation',
        }),
      })
    }
  }
  return defs
}

function parseCrate(data, name, url) {
  const crate = data?.crate || {}
  const versions = Array.isArray(data?.versions) ? data.versions : []
  const stable = crate.max_stable_version || crate.newest_version || crate.max_version || null
  const pre = crate.max_version && crate.max_version !== stable ? crate.max_version : null
  const entry =
    versions.find((item) => item.num === stable && !item.yanked) ||
    versions.find((item) => item.num === stable) ||
    versions.find((item) => !item.yanked) ||
    null
  return {
    version: stable,
    preRelease: pre,
    msrv: entry?.rust_version || null,
    edition: entry?.edition || null,
    date: crate.updated_at || entry?.created_at || null,
    url,
    note: pre ? `pre-release: ${pre}` : 'stable',
  }
}

function parsePostgres(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.versions) ? data.versions : []
  if (!list.length) throw new Error('unexpected PostgreSQL versions payload')
  const current = list.find((item) => item.current) || list[0]
  const supported = list.filter((item) => item.supported).map((item) => String(item.major))
  const currentVersion = `${current.major}.${current.latestMinor ?? 0}`
  const eol = current.eolDate || current.eol_date || null
  return {
    version: currentVersion,
    date: current.relDate || current.rel_date || null,
    eol,
    supported,
    url: 'https://www.postgresql.org/support/versioning/',
    note: `supported majors: ${supported.join(', ')}${eol ? `; EOL ${eol}` : ''}`,
  }
}

function parseSqlite(text) {
  const matches = [...String(text).matchAll(/sqlite-(?:src|amalgamation)-(\d{7,})\.zip/gi)]
  if (!matches.length) throw new Error('could not find SQLite version in download page')
  const digits = matches.map((match) => match[1]).sort((a, b) => Number(b) - Number(a))[0]
  const version = `${digits.slice(0, 1)}.${Number(digits.slice(1, 3))}.${Number(digits.slice(3, 5))}`
  return {
    version,
    date: null,
    url: 'https://www.sqlite.org/download.html',
    note: 'stable release',
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

async function checkOne(def, options) {
  try {
    if (def.kind === 'docs') {
      const response = await fetchText(def.url, {
        fetchImpl: options.fetchImpl,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxBytes: 64 * 1024,
        headers: { accept: 'text/html' },
      })
      return { id: def.id, label: def.label, kind: def.kind, status: response.ok ? 'ok' : 'error', ...def.parse(null, response) }
    }
    const isJson = def.url.includes('api.github.com') || def.url.includes('crates.io') || def.url.endsWith('.json')
    const payload = isJson
      ? await fetchJson(def.url, { fetchImpl: options.fetchImpl, signal: options.signal, timeoutMs: options.timeoutMs })
      : (await fetchText(def.url, {
          fetchImpl: options.fetchImpl,
          signal: options.signal,
          timeoutMs: options.timeoutMs,
          maxBytes: 2 * 1024 * 1024,
        })).text
    const parsed = def.parse(payload)
    return { id: def.id, label: def.label, kind: def.kind, status: 'ok', ...parsed }
  } catch (error) {
    return {
      id: def.id,
      label: def.label,
      kind: def.kind,
      status: isAbortError(error) ? 'aborted' : 'error',
      error: error?.message || String(error),
    }
  }
}

export async function checkSources({
  sources,
  includeDocs = false,
  fetchImpl,
  signal,
  timeoutMs = 12000,
  concurrency = 4,
} = {}) {
  const selected = new Set(
    Array.isArray(sources) && sources.length
      ? sources
      : includeDocs
        ? [...TECH_IDS, ...DOC_SOURCES.map(([id]) => id)]
        : TECH_IDS,
  )
  const defs = sourceDefs(includeDocs || [...selected].some((id) => id.startsWith('docs:')))
    .filter((def) => selected.has(def.id))
  if (!defs.length) throw new Error('no known sources selected')
  const items = await mapLimit(defs, concurrency, (def) => checkOne(def, { fetchImpl, signal, timeoutMs }))
  return {
    ok: items.filter((item) => item.kind === 'tech').every((item) => item.status === 'ok'),
    checkedAt: new Date().toISOString(),
    items,
  }
}

export async function readVersions(skillDir) {
  try {
    const raw = await fs.readFile(path.join(skillDir, 'versions.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : { schemaVersion: 1, items: [] }
  } catch {
    return { schemaVersion: 1, items: [] }
  }
}

export function mergeVersions(previous, check) {
  const prevById = new Map((previous?.items || []).map((item) => [item.id, item]))
  const items = check.items.map((item) => {
    if (item.status === 'ok') return item
    const old = prevById.get(item.id)
    return {
      ...(old || { id: item.id, label: item.label, kind: item.kind }),
      status: item.status,
      error: item.error,
      lastGood: old?.lastGood || old?.version || null,
    }
  })
  const technologies = Object.fromEntries(items.filter((item) => item.kind === 'tech').map((item) => [item.id, item]))
  return {
    schemaVersion: 1,
    checkedAt: check.checkedAt,
    skillVersion: previous?.skillVersion || null,
    items,
    technologies,
    docs: items.filter((item) => item.kind === 'docs'),
  }
}

export async function checkAndWrite({
  skillDir,
  sources,
  includeDocs = false,
  fetchImpl,
  signal,
  write = true,
} = {}) {
  const previous = await readVersions(skillDir)
  const check = await checkSources({ sources, includeDocs, fetchImpl, signal })
  const merged = mergeVersions(previous, check)
  if (write) await updateGeneratedFiles(skillDir, merged)
  return { check, versions: merged }
}

export function isStale(lastCheck, ttlHours) {
  if (!lastCheck) return true
  const parsed = Date.parse(lastCheck)
  if (!Number.isFinite(parsed)) return true
  return Date.now() - parsed > Math.max(1, ttlHours) * 60 * 60 * 1000
}

export function defaultSources() {
  return [...TECH_IDS]
}
