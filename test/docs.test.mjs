import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { clearDocsCache, fetchDocs, htmlToText, validateUrl } from '../lib/docs.js'

test('validateUrl only allows official HTTPS hosts and paths', () => {
  assert.equal(validateUrl('https://docs.rs/axum/latest/axum/'), 'https://docs.rs/axum/latest/axum/')
  assert.equal(validateUrl('https://book.leptos.dev/'), 'https://book.leptos.dev/')
  for (const bad of [
    'http://docs.rs/axum/',
    'https://evil.example/',
    'https://docs.rs.evil.example/axum/',
    'https://user:pass@docs.rs/axum/',
    'https://docs.rs:8443/axum/',
    'https://www.postgresql.org/about/',
    'https://dioxuslabs.com/pricing/',
  ]) {
    assert.throws(() => validateUrl(bad), undefined, bad)
  }
})

test('htmlToText drops chrome and decodes entities', () => {
  const { title, text } = htmlToText(
    '<html><head><title>Axum &amp; SQLx</title><style>.x{}</style></head><body><nav>menu</nav><h1>Routing</h1><p>Use <code>/{id}</code> &mdash; safe.</p><script>alert(1)</script></body></html>',
  )
  assert.equal(title, 'Axum & SQLx')
  assert.match(text, /Routing/)
  assert.match(text, /\{id\}/)
  assert.match(text, /— safe/)
  assert.doesNotMatch(text, /alert|menu/)
})

test('fetchDocs caches a bounded excerpt', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rust-docs-'))
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return new Response('<html><title>Axum</title><body><h1>Routing</h1><p>Use /{id}.</p></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
  }
  try {
    const first = await fetchDocs({ topic: 'axum', cacheDir: dir, fetchImpl, maxChars: 500 })
    assert.equal(first.ok, true)
    assert.equal(first.cached, false)
    assert.match(first.excerpt, /Routing/)
    const second = await fetchDocs({ topic: 'axum', cacheDir: dir, fetchImpl, maxChars: 500 })
    assert.equal(second.ok, true)
    assert.equal(second.cached, true)
    assert.equal(calls, 1)
    await clearDocsCache(dir)
    await assert.rejects(fs.stat(dir))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('fetchDocs rejects unknown topics and non-HTML content', async () => {
  const missing = await fetchDocs({ topic: 'unknown-topic' })
  assert.equal(missing.ok, false)
  const binary = await fetchDocs({
    url: 'https://docs.rs/axum/latest/axum/',
    fetchImpl: async () => new Response('x', { status: 200, headers: { 'content-type': 'application/pdf' } }),
  })
  assert.equal(binary.ok, false)
  assert.equal(binary.error, 'unsupported_content_type')
})
