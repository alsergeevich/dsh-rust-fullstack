import { PACKAGE_VERSION } from './config.js'

export const USER_AGENT = `dsh-rust-fullstack/${PACKAGE_VERSION} (+https://github.com/alsergeevich/dsh-rust-fullstack)`

export class HttpError extends Error {
  constructor(message, { code = 'HTTP_ERROR', status = 0, url = '' } = {}) {
    super(message)
    this.name = 'HttpError'
    this.code = code
    this.status = status
    this.url = url
  }
}

function timeoutSignal(timeoutMs, signal) {
  const timeout = AbortSignal.timeout(Math.max(1000, timeoutMs))
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function mergeHeaders(extra) {
  return {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5',
    ...(extra || {}),
  }
}

export async function fetchRaw(url, options = {}) {
  const {
    timeoutMs = 12000,
    signal,
    headers,
    method = 'GET',
    redirect = 'follow',
    fetchImpl = globalThis.fetch,
  } = options
  if (typeof fetchImpl !== 'function') {
    throw new HttpError('fetch is not available', { code: 'NO_FETCH', url })
  }
  const init = {
    method,
    redirect,
    headers: mergeHeaders(headers),
    signal: timeoutSignal(timeoutMs, signal),
  }
  return fetchImpl(url, init)
}

export async function readBody(response, maxBytes = 2 * 1024 * 1024) {
  if (!response.body) return await response.text()
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new HttpError(`response exceeded ${maxBytes} bytes`, {
          code: 'BODY_TOO_LARGE',
          status: response.status,
          url: response.url,
        })
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock?.()
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function fetchText(url, options = {}) {
  const response = await fetchRaw(url, options)
  const text = await readBody(response, options.maxBytes ?? 2 * 1024 * 1024)
  return {
    ok: response.ok,
    status: response.status,
    url: response.url || url,
    headers: response.headers,
    text,
  }
}

export async function fetchJson(url, options = {}) {
  const result = await fetchText(url, options)
  if (!result.ok) {
    throw new HttpError(`HTTP ${result.status} for ${url}`, {
      code: 'HTTP_STATUS',
      status: result.status,
      url,
    })
  }
  try {
    return JSON.parse(result.text)
  } catch (error) {
    throw new HttpError(`invalid JSON from ${url}`, { code: 'BAD_JSON', status: result.status, url })
  }
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
}
