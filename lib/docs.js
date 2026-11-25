import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fetchRaw, readBody } from './http.js'

export const TOPICS = Object.freeze({
  rust: 'https://doc.rust-lang.org/book/',
  axum: 'https://docs.rs/axum/latest/axum/',
  leptos: 'https://book.leptos.dev/',
  dioxus: 'https://dioxuslabs.com/learn/0.7/',
  sqlx: 'https://docs.rs/sqlx/latest/sqlx/',
  postgres: 'https://www.postgresql.org/docs/current/',
  sqlite: 'https://www.sqlite.org/docs.html',
  tokio: 'https://tokio.rs/tokio/tutorial',
  tower: 'https://docs.rs/tower-http/latest/tower_http/',
  testing: 'https://doc.rust-lang.org/book/ch11-00-testing.html',
  security: 'https://doc.rust-lang.org/book/ch12-00-an-io-project.html',
})

const ALLOWED_HOSTS = new Set([
  'doc.rust-lang.org',
  'docs.rs',
  'leptos.dev',
  'book.leptos.dev',
  'dioxuslabs.com',
  'www.postgresql.org',
  'www.sqlite.org',
  'tokio.rs',
  'rust-lang.github.io',
])

const MAX_HTML_BYTES = 2 * 1024 * 1024
const CACHE_LIMIT = 50

export function validateUrl(input) {
  let url
  try {
    url = new URL(String(input))
  } catch {
    throw new Error('invalid_url')
  }
  if (url.protocol !== 'https:') throw new Error('https_required')
  if (url.username || url.password) throw new Error('credentials_not_allowed')
  if (url.port && url.port !== '443') throw new Error('port_not_allowed')
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error('host_not_allowed')
  if (url.hostname === 'www.postgresql.org' && !url.pathname.startsWith('/docs/') && !url.pathname.startsWith('/support/')) {
    throw new Error('path_not_allowed')
  }
  if (url.hostname === 'dioxuslabs.com' && !url.pathname.startsWith('/learn/')) {
    throw new Error('path_not_allowed')
  }
  return url.toString()
}

function decodeEntities(text) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
  }
  return text
    .replace(/&#(\d+);/g, (_match, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
}

export function htmlToText(html) {
  const source = String(html || '')
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : ''
  const text = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|pre|blockquote|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const decoded = decodeEntities(text)
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title, text: decoded }
}

function cacheKey(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 40) + '.json'
}

async function readCache(cacheDir, url, ttlHours) {
  if (!cacheDir) return null
  try {
    const raw = await fs.readFile(path.join(cacheDir, cacheKey(url)), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed?.url !== url || typeof parsed.text !== 'string') return null
    const age = Date.now() - Date.parse(parsed.fetchedAt)
    if (!Number.isFinite(age) || age > Math.max(1, ttlHours) * 60 * 60 * 1000) return null
    return parsed
  } catch {
    return null
  }
}

async function writeCache(cacheDir, entry) {
  if (!cacheDir) return
  try {
    await fs.mkdir(cacheDir, { recursive: true })
    const file = path.join(cacheDir, cacheKey(entry.url))
    const tmp = `${file}.tmp-${process.pid}`
    await fs.writeFile(tmp, JSON.stringify(entry, null, 2) + '\n')
    await fs.rename(tmp, file)
    const entries = await fs.readdir(cacheDir)
    if (entries.length > CACHE_LIMIT) {
      const stats = await Promise.all(
        entries.map(async (name) => {
          const full = path.join(cacheDir, name)
          const stat = await fs.stat(full).catch(() => null)
          return { full, at: stat?.mtimeMs || 0 }
        }),
      )
      stats.sort((a, b) => a.at - b.at)
      for (const item of stats.slice(0, stats.length - CACHE_LIMIT)) {
        await fs.rm(item.full, { force: true }).catch(() => {})
      }
    }
  } catch {
    // cache is best-effort
  }
}

async function fetchWithRedirects(url, { fetchImpl, signal, timeoutMs }) {
  let current = url
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchRaw(current, {
      fetchImpl,
      signal,
      timeoutMs,
      redirect: 'manual',
      headers: { accept: 'text/html,text/plain;q=0.9' },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('redirect_without_location')
      current = validateUrl(new URL(location, current).toString())
      continue
    }
    return { response, url: current }
  }
  throw new Error('too_many_redirects')
}

export async function fetchDocs({
  topic,
  url,
  maxChars = 12000,
  cacheDir,
  cacheTtlHours = 24,
  fetchImpl,
  signal,
  timeoutMs = 12000,
} = {}) {
  const requested = url || (topic ? TOPICS[String(topic).toLowerCase()] : null)
  if (!requested) {
    return { ok: false, error: 'unknown_topic', message: `Known topics: ${Object.keys(TOPICS).join(', ')}` }
  }
  let safeUrl
  try {
    safeUrl = validateUrl(requested)
  } catch (error) {
    return { ok: false, error: error.message, url: String(requested) }
  }

  const cached = await readCache(cacheDir, safeUrl, cacheTtlHours)
  if (cached) {
    return {
      ok: true,
      url: safeUrl,
      title: cached.title || '',
      excerpt: cached.text.slice(0, maxChars),
      truncated: cached.text.length > maxChars,
      fetchedAt: cached.fetchedAt,
      cached: true,
    }
  }

  try {
    const { response, url: finalUrl } = await fetchWithRedirects(safeUrl, { fetchImpl, signal, timeoutMs })
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, status: response.status, url: finalUrl }
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType && !/(text\/html|text\/plain|application\/xhtml\+xml|text\/markdown)/i.test(contentType)) {
      return { ok: false, error: 'unsupported_content_type', contentType, url: finalUrl }
    }
    const html = await readBody(response, MAX_HTML_BYTES)
    const parsed = htmlToText(html)
    const text = parsed.text.slice(0, 30000)
    const fetchedAt = new Date().toISOString()
    const entry = {
      url: finalUrl,
      title: parsed.title,
      text,
      fetchedAt,
      etag: response.headers.get('etag') || null,
      lastModified: response.headers.get('last-modified') || null,
    }
    await writeCache(cacheDir, entry)
    return {
      ok: true,
      url: finalUrl,
      title: parsed.title,
      excerpt: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      fetchedAt,
      cached: false,
    }
  } catch (error) {
    return { ok: false, error: error?.message || String(error), url: safeUrl }
  }
}

export async function clearDocsCache(cacheDir) {
  if (!cacheDir) return
  try {
    await fs.rm(cacheDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}
