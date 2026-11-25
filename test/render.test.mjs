import assert from 'node:assert/strict'
import test from 'node:test'
import { compactProject, renderActivation, renderSkillContent, textBlocks } from '../lib/render.js'

const SKILL = {
  name: 'rust-fullstack-elite',
  content: '# Rust Full-Stack Elite\n\nUse official docs.\n',
  resourceBase: { kind: 'directory', path: 'F:\\skills\\rust-fullstack-elite' },
}

test('renderSkillContent uses the canonical envelope and resource hint', () => {
  const text = renderSkillContent(SKILL)
  assert.match(text, /^<skill_content name="rust-fullstack-elite">/)
  assert.match(text, /<skill_resources>/)
  assert.match(text, /Base directory for this skill: F:\\skills\\rust-fullstack-elite/)
  assert.match(text, /<skill_instructions>\n# Rust Full-Stack Elite/)
  assert.match(text, /<\/skill_content>$/)
})

test('renderActivation includes project context and truncates oversized bodies', () => {
  const body = Array.from({ length: 2000 }, (_, index) => `line ${index}`).join('\n')
  const result = renderActivation({
    skill: { ...SKILL, content: body },
    project: {
      hasCargo: true,
      root: 'F:\\work\\demo',
      packageName: 'demo',
      edition: '2021',
      rustVersion: '1.88',
      toolchain: '1.100.0',
      frameworks: ['axum', 'sqlx'],
      databases: ['postgresql'],
      versions: { axum: '0.8.9' },
      migrations: true,
      rustFileCount: 12,
      workspace: false,
    },
    evidence: ['src/main.rs'],
    maxChars: 2000,
  })
  assert.equal(result.truncated, true)
  assert.match(result.text, /Rust work detected/)
  assert.match(result.text, /<rust_project_context>/)
  assert.match(result.text, /frameworks: axum, sqlx/)
  assert.match(result.text, /Activation truncated/)
  assert.match(result.text, /<skill_content name="rust-fullstack-elite">/)
})

test('compactProject and textBlocks are stable', () => {
  assert.deepEqual(compactProject(null), { hasCargo: false, root: null })
  assert.deepEqual(textBlocks('x'), [{ type: 'text', text: 'x' }])
})
