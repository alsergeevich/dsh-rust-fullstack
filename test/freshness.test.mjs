import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkAndWrite, checkSources, isStale, mergeVersions, readVersions } from '../lib/freshness.js'

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function htmlResponse(value) {
  return new Response(value, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

test('checkSources parses crates.io, Rust, PostgreSQL, and SQLite', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('crates.io')) {
      return jsonResponse({
        crate: { max_stable_version: '0.8.9', max_version: '0.8.9', updated_at: '2026-04-14' },
        versions: [{ num: '0.8.9', rust_version: '1.80', edition: '2021' }],
      })
    }
    if (url.includes('api.github.com')) {
      return jsonResponse({ tag_name: '1.100.0', published_at: '2026-11-12', html_url: 'https://github.com/rust-lang/rust/releases/tag/1.100.0' })
    }
    if (url.includes('postgresql.org')) {
      return jsonResponse([
        { major: 19, latestMinor: 0, current: true, supported: true, relDate: '2026-11-19', eolDate: '2031-11-19' },
        { major: 14, latestMinor: 0, current: false, supported: false },
      ])
    }
    if (url.includes('sqlite.org')) {
      return htmlResponse('<a href="sqlite-src-3540100.zip">sqlite</a>')
    }
    if (url.includes('docs.rs')) return htmlResponse('<title>Docs</title><p>ok</p>')
    throw new Error(`unexpected URL: ${url}`)
  }
  const result = await checkSources({
    sources: ['crates:axum', 'rust', 'postgres', 'sqlite', 'docs:axum'],
    fetchImpl,
  })
  assert.equal(result.items.length, 5)
  const byId = Object.fromEntries(result.items.map((item) => [item.id, item]))
  assert.equal(byId['crates:axum'].version, '0.8.9')
  assert.equal(byId['crates:axum'].msrv, '1.80')
  assert.equal(byId.rust.version, '1.100.0')
  assert.equal(byId.postgres.version, '19.0')
  assert.deepEqual(byId.postgres.supported, ['19'])
  assert.equal(byId.sqlite.version, '3.54.1')
  assert.equal(byId['docs:axum'].status, 'ok')
})

test('mergeVersions keeps the last good value when a source fails', () => {
  const previous = {
    schemaVersion: 1,
    items: [{ id: 'crates:axum', label: 'Axum', kind: 'tech', status: 'ok', version: '0.8.8' }],
  }
  const check = {
    checkedAt: '2026-11-25T00:00:00.000Z',
    items: [{ id: 'crates:axum', label: 'Axum', kind: 'tech', status: 'error', error: 'offline' }],
  }
  const merged = mergeVersions(previous, check)
  assert.equal(merged.items[0].version, '0.8.8')
  assert.equal(merged.items[0].status, 'error')
  assert.equal(merged.items[0].lastGood, '0.8.8')
  assert.equal(merged.checkedAt, check.checkedAt)
})

test('checkAndWrite writes versions.json and versions.md', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rust-fresh-'))
  try {
    const fetchImpl = async () =>
      jsonResponse({
        crate: { max_stable_version: '0.8.9', max_version: '0.8.9' },
        versions: [{ num: '0.8.9', rust_version: '1.80' }],
      })
    const result = await checkAndWrite({ skillDir: dir, sources: ['crates:axum'], fetchImpl })
    assert.equal(result.versions.items[0].version, '0.8.9')
    const written = await readVersions(dir)
    assert.equal(written.items[0].version, '0.8.9')
    const markdown = await fs.readFile(path.join(dir, 'versions.md'), 'utf8')
    assert.match(markdown, /Axum/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('isStale handles missing, invalid, and future timestamps', () => {
  assert.equal(isStale(null, 24), true)
  assert.equal(isStale('not-a-date', 24), true)
  assert.equal(isStale(new Date().toISOString(), 24), false)
  assert.equal(isStale(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), 24), true)
})
