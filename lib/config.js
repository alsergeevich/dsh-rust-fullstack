export const SKILL_NAME = 'rust-fullstack-elite'
export const PACKAGE_VERSION = '0.1.1'
export const DEFAULT_REPO = 'alsergeevich/dsh-rust-fullstack'

export const DEFAULTS = Object.freeze({
  skillName: SKILL_NAME,
  autoActivate: true,
  activationThreshold: 60,
  installGlobalSkill: true,
  autoCheck: 'daily',
  autoUpdate: 'skill',
  checkTtlHours: 24,
  maxInjectionChars: 24000,
  githubRepo: DEFAULT_REPO,
  docsCacheTtlHours: 24,
  notifyOnUpdate: false,
})

const AUTO_CHECK = new Set(['off', 'daily', 'weekly'])
const AUTO_UPDATE = new Set(['off', 'metadata', 'skill'])
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1) return true
  if (value === 'false' || value === 0) return false
  return fallback
}

function asInteger(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

export function normalizeConfig(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const skillName = typeof raw.skillName === 'string' && KEBAB.test(raw.skillName) ? raw.skillName : DEFAULTS.skillName
  const githubRepo = typeof raw.githubRepo === 'string' && REPO.test(raw.githubRepo) ? raw.githubRepo : DEFAULTS.githubRepo
  const autoCheck = AUTO_CHECK.has(raw.autoCheck) ? raw.autoCheck : DEFAULTS.autoCheck
  const autoUpdate = AUTO_UPDATE.has(raw.autoUpdate) ? raw.autoUpdate : DEFAULTS.autoUpdate

  return Object.freeze({
    skillName,
    autoActivate: asBoolean(raw.autoActivate, DEFAULTS.autoActivate),
    activationThreshold: asInteger(raw.activationThreshold, DEFAULTS.activationThreshold, 0, 100),
    installGlobalSkill: asBoolean(raw.installGlobalSkill, DEFAULTS.installGlobalSkill),
    autoCheck,
    autoUpdate,
    checkTtlHours: asInteger(raw.checkTtlHours, DEFAULTS.checkTtlHours, 1, 720),
    maxInjectionChars: asInteger(raw.maxInjectionChars, DEFAULTS.maxInjectionChars, 4000, 100000),
    githubRepo,
    docsCacheTtlHours: asInteger(raw.docsCacheTtlHours, DEFAULTS.docsCacheTtlHours, 1, 720),
    notifyOnUpdate: asBoolean(raw.notifyOnUpdate, DEFAULTS.notifyOnUpdate),
  })
}

export function checkIntervalMs(autoCheck) {
  if (autoCheck === 'daily') return 24 * 60 * 60 * 1000
  if (autoCheck === 'weekly') return 7 * 24 * 60 * 60 * 1000
  return 0
}
