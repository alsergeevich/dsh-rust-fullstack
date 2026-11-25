import assert from 'node:assert/strict'
import test from 'node:test'
import { checkIntervalMs, DEFAULTS, normalizeConfig } from '../lib/config.js'

test('normalizeConfig returns safe defaults', () => {
  const cfg = normalizeConfig({})
  assert.equal(cfg.skillName, 'rust-fullstack-elite')
  assert.equal(cfg.autoActivate, true)
  assert.equal(cfg.activationThreshold, 60)
  assert.equal(cfg.autoCheck, 'daily')
  assert.equal(cfg.autoUpdate, 'skill')
  assert.equal(cfg.maxInjectionChars, 24000)
  assert.equal(cfg.githubRepo, DEFAULTS.githubRepo)
  assert.ok(Object.isFrozen(cfg))
})

test('normalizeConfig clamps and rejects unknown values', () => {
  const cfg = normalizeConfig({
    activationThreshold: 999,
    maxInjectionChars: 1,
    checkTtlHours: 0,
    autoCheck: 'sometimes',
    autoUpdate: 'everything',
    skillName: 'Not Kebab',
    githubRepo: 'not-a-repo',
  })
  assert.equal(cfg.activationThreshold, 100)
  assert.equal(cfg.maxInjectionChars, 4000)
  assert.equal(cfg.checkTtlHours, 1)
  assert.equal(cfg.autoCheck, 'daily')
  assert.equal(cfg.autoUpdate, 'skill')
  assert.equal(cfg.skillName, 'rust-fullstack-elite')
  assert.equal(cfg.githubRepo, DEFAULTS.githubRepo)
})

test('checkIntervalMs maps schedules', () => {
  assert.equal(checkIntervalMs('off'), 0)
  assert.equal(checkIntervalMs('daily'), 24 * 60 * 60 * 1000)
  assert.equal(checkIntervalMs('weekly'), 7 * 24 * 60 * 60 * 1000)
})
