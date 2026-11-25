import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  applyPack,
  ensureGlobalSkill,
  globalSkillStatus,
  parseSkillMarkdown,
  sha256,
  validatePackIndex,
} from '../lib/skill-store.js'

const SKILL = `---
name: rust-fullstack-elite
description: "Elite Rust full-stack skill for tests."
metadata:
  version: "0.1.0"
  pack: "v0.1.0"
---

# Test skill

Use the official docs.
`

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('parseSkillMarkdown reads nested metadata and body', () => {
  const parsed = parseSkillMarkdown(SKILL)
  assert.equal(parsed.meta.name, 'rust-fullstack-elite')
  assert.equal(parsed.meta.description, 'Elite Rust full-stack skill for tests.')
  assert.equal(parsed.meta.metadata.version, '0.1.0')
  assert.equal(parsed.meta.metadata.pack, 'v0.1.0')
  assert.match(parsed.body, /^# Test skill/)
})

test('ensureGlobalSkill installs, preserves user edits, and backs up on force', async () => {
  const root = await tempDir('dsh-rust-skill-')
  const source = path.join(root, 'source')
  const target = path.join(root, 'target')
  const backups = path.join(root, 'backups')
  try {
    await fs.mkdir(path.join(source, 'references'), { recursive: true })
    await fs.writeFile(path.join(source, 'SKILL.md'), SKILL)
    await fs.writeFile(path.join(source, 'references', 'rust-core.md'), '# Rust core\n')
    const first = await ensureGlobalSkill({ sourceDir: source, targetDir: target, backupRoot: backups })
    assert.equal(first.ok, true)
    assert.ok(first.installed.includes('SKILL.md'))
    assert.ok(await fs.stat(path.join(target, 'SKILL.md')))
    const manifest = JSON.parse(await fs.readFile(path.join(target, '.dsh-rust-fullstack.json'), 'utf8'))
    assert.equal(manifest.skillVersion, '0.1.0')
    assert.equal(manifest.skillPack, 'v0.1.0')

    await fs.writeFile(path.join(target, 'SKILL.md'), SKILL.replace('official docs', 'my customized docs'))
    const second = await ensureGlobalSkill({ sourceDir: source, targetDir: target, backupRoot: backups })
    assert.ok(second.skippedUserModified.includes('SKILL.md'))
    assert.match(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), /my customized docs/)

    const forced = await ensureGlobalSkill({ sourceDir: source, targetDir: target, backupRoot: backups, force: true })
    assert.equal(forced.ok, true)
    assert.ok(forced.backupPath)
    assert.match(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), /official docs/)
    const status = await globalSkillStatus({ targetDir: target })
    assert.equal(status.exists, true)
    assert.equal(status.userModified.length, 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('validatePackIndex rejects unsafe paths and oversized packs', () => {
  const base = {
    schemaVersion: 1,
    skillVersion: '0.1.0',
    files: [{ path: 'SKILL.md', sha256: 'a'.repeat(64), bytes: 10 }],
  }
  assert.equal(validatePackIndex(base).ok, true)
  for (const bad of ['../SKILL.md', '/etc/passwd', 'a\\b.md', 'C:/x.md', 'a\u0000b.md']) {
    const result = validatePackIndex({ ...base, files: [{ path: bad, sha256: 'a'.repeat(64), bytes: 10 }] })
    assert.equal(result.ok, false, bad)
  }
  assert.equal(validatePackIndex({ ...base, files: [] }).ok, false)
})

test('applyPack refuses to overwrite an unmanaged user file unless forced', async () => {
  const root = await tempDir('dsh-rust-pack-')
  const target = path.join(root, 'target')
  try {
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(target, 'SKILL.md'), 'user content')
    const next = 'pack content'
    const pack = {
      tag: 'v0.2.0',
      index: {
        schemaVersion: 1,
        skillVersion: '0.2.0',
        files: [{ path: 'SKILL.md', sha256: sha256(Buffer.from(next)), bytes: Buffer.byteLength(next) }],
      },
      files: new Map([['SKILL.md', Buffer.from(next)]]),
    }
    const skipped = await applyPack({ pack, targetDir: target, backupRoot: path.join(root, 'backups') })
    assert.ok(skipped.skippedUserModified.includes('SKILL.md'))
    assert.equal(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), 'user content')
    const forced = await applyPack({ pack, targetDir: target, backupRoot: path.join(root, 'backups'), force: true })
    assert.ok(forced.applied.includes('SKILL.md'))
    assert.equal(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), next)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
