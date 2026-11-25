import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeConfig } from '../lib/config.js'
import { createTools } from '../lib/tools.js'

async function makeState() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rust-tools-'))
  const state = {
    config: normalizeConfig({ autoCheck: 'off' }),
    paths: {
      globalSkillDir: path.join(root, 'skills', 'rust-fullstack-elite'),
      backupDir: path.join(root, 'backups'),
      cacheDir: path.join(root, 'cache'),
    },
    runExclusive: (fn) => fn(),
  }
  return { root, state }
}

function makeCtx(cwd) {
  return {
    workingDirectory: { ensure: async () => cwd },
  }
}

test('createTools exposes the five documented tools with output renderers', async () => {
  const { root, state } = await makeState()
  try {
    const tools = createTools(makeCtx(root), state)
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ['rust_docs', 'rust_project_scan', 'rust_skill_check', 'rust_skill_status', 'rust_skill_update'],
    )
    for (const tool of tools) {
      assert.equal(typeof tool.description, 'string')
      assert.equal(tool.parameters.type, 'object')
      assert.equal(typeof tool.execute, 'function')
      assert.equal(typeof tool.output.render, 'function')
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('status and project scan work without network access', async () => {
  const { root, state } = await makeState()
  try {
    const tools = createTools(makeCtx(root), state)
    const status = tools.find((tool) => tool.name === 'rust_skill_status')
    const statusResult = await status.execute({ includeProject: false }, { agent: undefined, signal: undefined })
    assert.equal(statusResult.ok, true)
    assert.match(statusResult.text, /Rust Full-Stack plugin/)
    assert.match(statusResult.text, /Global skill:/)

    const scan = tools.find((tool) => tool.name === 'rust_project_scan')
    const scanResult = await scan.execute({ path: root, maxFiles: 100 }, { agent: undefined })
    assert.equal(scanResult.ok, true)
    assert.match(scanResult.text, /No Cargo\.toml/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('docs tool requires a topic or URL', async () => {
  const { root, state } = await makeState()
  try {
    const tools = createTools(makeCtx(root), state)
    const docs = tools.find((tool) => tool.name === 'rust_docs')
    const result = await docs.execute({}, { agent: undefined })
    assert.equal(result.ok, false)
    assert.match(result.text, /Provide topic or url/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
