import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply } from '../lib/index.js'

async function makeCtx(cwd) {
  const handlers = new Map()
  const tools = []
  const ctx = {
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    skills: {
      async get() {
        return undefined
      },
    },
    workingDirectory: {
      async ensure() {
        return cwd
      },
    },
    on(event, handler) {
      handlers.set(event, handler)
      return () => {}
    },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
  return { ctx, handlers, tools }
}

function userMessage(text) {
  return { id: `m-${Math.random()}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

test('agent/pre-step activates the skill once and injects canonical skill content', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rust-home-'))
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rust-cwd-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { ctx, handlers, tools } = await makeCtx(cwd)
    const cleanup = await apply(ctx, { installGlobalSkill: false, autoCheck: 'off' })
    assert.equal(tools.length, 5)
    const preStep = handlers.get('agent/pre-step')
    assert.equal(typeof preStep, 'function')

    const msg = userMessage('Please implement an Axum endpoint in src/main.rs.')
    const next = async () => ({ kind: 'continue', messages: [msg] })
    const first = await preStep({ agent: { id: 'session-1' }, messages: [msg] }, next)
    assert.equal(first.messages.length, 2)
    assert.match(first.messages[1].content[0].text, /Rust work detected/)
    assert.match(first.messages[1].content[0].text, /<skill_content name="rust-fullstack-elite">/)
    assert.equal(first.messages[1].source.kind, 'skill-invocation')
    assert.equal(first.messages[1].source.name, 'rust-fullstack-elite')

    const second = await preStep({ agent: { id: 'session-1' }, messages: [msg] }, next)
    assert.equal(second.messages.length, 1)

    const empty = async () => ({ kind: 'continue', messages: [] })
    await preStep({ agent: { id: 'session-2' }, messages: [] }, empty)
    assert.ok(first.messages[1].content[0].text.length > 100)
    cleanup()
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await fs.rm(home, { recursive: true, force: true })
    await fs.rm(cwd, { recursive: true, force: true })
  }
})

test('tool activity is remembered and can activate the next step', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rust-home-'))
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rust-cwd-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { ctx, handlers } = await makeCtx(cwd)
    await apply(ctx, { installGlobalSkill: false, autoCheck: 'off' })
    const preStep = handlers.get('agent/pre-step')
    const preTool = handlers.get('tools/pre-execute')

    const write = await preTool(
      { name: 'write', arguments: { file_path: 'src/main.rs', content: 'fn main() {}' }, agent: { id: 'session-3' } },
      async () => ({ kind: 'allow' }),
    )
    assert.equal(write.kind, 'allow')

    const decision = await preStep({ agent: { id: 'session-3' }, messages: [] }, async () => ({ kind: 'continue', messages: [] }))
    assert.equal(decision.messages.length, 1)
    assert.match(decision.messages[0].content[0].text, /<skill_content name="rust-fullstack-elite">/)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await fs.rm(home, { recursive: true, force: true })
    await fs.rm(cwd, { recursive: true, force: true })
  }
})

test('rust_skill_update requires approval unless dry-run', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rust-home-'))
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rust-cwd-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { ctx, handlers } = await makeCtx(cwd)
    await apply(ctx, { installGlobalSkill: false, autoCheck: 'off' })
    const preTool = handlers.get('tools/pre-execute')

    let bypassed = false
    const guarded = await preTool(
      { name: 'rust_skill_update', arguments: { dryRun: false }, agent: { id: 'session-4' } },
      async () => {
        bypassed = true
        return { kind: 'allow' }
      },
    )
    assert.equal(guarded.kind, 'ask')
    assert.equal(bypassed, false)

    const dry = await preTool(
      { name: 'rust_skill_update', arguments: { dryRun: true }, agent: { id: 'session-4' } },
      async () => ({ kind: 'allow' }),
    )
    assert.equal(dry.kind, 'allow')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await fs.rm(home, { recursive: true, force: true })
    await fs.rm(cwd, { recursive: true, force: true })
  }
})
