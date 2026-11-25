import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { detectLanguageFromPath, findCargoRoot, scanProject, clearProjectCache } from '../lib/project.js'

async function makeProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rust-project-'))
  await fs.writeFile(
    path.join(root, 'Cargo.toml'),
    `[package]
name = "demo"
version = "0.1.0"
edition = "2021"
rust-version = "1.88"

[workspace]
members = ["crates/domain"]

[dependencies]
axum = "0.8"
sqlx = { version = "0.9", features = ["runtime-tokio", "postgres", "sqlite"] }
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.7", features = ["trace"] }

[features]
default = ["postgres"]
`,
  )
  await fs.writeFile(
    path.join(root, 'Cargo.lock'),
    `version = 4

[[package]]
name = "axum"
version = "0.8.9"

[[package]]
name = "sqlx"
version = "0.9.1"

[[package]]
name = "tokio"
version = "1.54.1"
`,
  )
  await fs.writeFile(path.join(root, 'rust-toolchain.toml'), '[toolchain]\nchannel = "1.100.0"\n')
  await fs.mkdir(path.join(root, 'migrations'), { recursive: true })
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'main.rs'), 'fn main() {}\n')
  return root
}

test('findCargoRoot walks up to the manifest', async () => {
  const root = await makeProject()
  try {
    assert.equal(findCargoRoot(path.join(root, 'src')), root)
    assert.equal(findCargoRoot(path.join(os.tmpdir(), 'definitely-no-cargo-here')), null)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('scanProject reads package, workspace, frameworks, databases, lock versions, toolchain', async () => {
  const root = await makeProject()
  try {
    clearProjectCache()
    const project = await scanProject(root)
    assert.equal(project.hasCargo, true)
    assert.equal(project.packageName, 'demo')
    assert.equal(project.edition, '2021')
    assert.equal(project.rustVersion, '1.88')
    assert.equal(project.toolchain, '1.100.0')
    assert.deepEqual(project.workspace, ['crates/domain'])
    assert.ok(project.frameworks.includes('axum'))
    assert.ok(project.frameworks.includes('sqlx'))
    assert.ok(project.databases.includes('postgresql'))
    assert.ok(project.databases.includes('sqlite'))
    assert.equal(project.versions.axum, '0.8.9')
    assert.equal(project.versions.sqlx, '0.9.1')
    assert.equal(project.migrations, true)
    assert.equal(project.rustFileCount, 1)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('detectLanguageFromPath recognizes common files', () => {
  assert.equal(detectLanguageFromPath('src/main.rs'), 'rust')
  assert.equal(detectLanguageFromPath('Cargo.toml'), 'toml')
  assert.equal(detectLanguageFromPath('app.tsx'), 'typescript')
  assert.equal(detectLanguageFromPath('README.md'), null)
})
