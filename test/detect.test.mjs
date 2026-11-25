import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectLanguageFromText,
  detectRustInMessages,
  detectRustInToolCall,
  languageFromWritePath,
  scoreRustText,
} from '../lib/detect.js'

function userMessage(text) {
  return { source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

test('detects Rust intent in user messages', () => {
  const result = detectRustInMessages(
    [userMessage('Please implement an Axum endpoint in src/main.rs using SQLx.')],
    { hasCargo: true },
    60,
  )
  assert.equal(result.rust, true)
  assert.ok(result.score >= 60)
  assert.ok(result.evidence.length > 0)
})

test('does not activate on unrelated non-Rust work', () => {
  const result = detectRustInMessages([userMessage('Write a Python script that renames files.')], { hasCargo: false }, 60)
  assert.equal(result.rust, false)
})

test('write/edit Rust files and cargo commands are strong evidence', () => {
  const write = detectRustInToolCall('write', { file_path: 'crates/api/src/main.rs', content: 'fn main() {}' }, { hasCargo: false }, 60)
  assert.equal(write.rust, true)
  const shell = detectRustInToolCall('pwsh', { command: 'cargo test --all-features' }, { hasCargo: false }, 60)
  assert.equal(shell.rust, true)
  const patch = detectRustInToolCall('apply_patch', { input: '*** Update File: src/lib.rs' }, { hasCargo: false }, 60)
  assert.equal(patch.rust, true)
})

test('ignored paths do not count as Rust evidence', () => {
  const result = detectRustInToolCall('write', { file_path: 'target/debug/foo.rs' }, { hasCargo: false }, 60)
  assert.equal(result.rust, false)
})

test('scores Rust syntax and language detection', () => {
  const text = 'impl Foo { pub async fn bar() -> Result<(), Error> { Ok(()) } }'
  assert.ok(scoreRustText(text, { hasCargo: false }).score >= 70)
  assert.equal(detectLanguageFromText(text).language, 'rust')
  assert.equal(languageFromWritePath('src/lib.rs'), 'rust')
  assert.equal(languageFromWritePath('app.py'), 'python')
})
