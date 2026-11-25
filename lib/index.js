import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { checkIntervalMs, normalizeConfig, PACKAGE_VERSION } from './config.js'
import { detectLanguageFromText, detectRustInMessages, detectRustInToolCall, extractMessageText, languageFromWritePath } from './detect.js'
import { checkAndWrite, isStale, readVersions } from './freshness.js'
import { scanProject } from './project.js'
import { renderActivation } from './render.js'
import {
  applyPack,
  bundledSkillDir,
  downloadPack,
  ensureGlobalSkill,
  getLatestPluginRelease,
  globalSkillDirFor,
  loadSkill,
  readManifest,
  storePaths,
} from './skill-store.js'
import { createTools } from './tools.js'

export const inject = ['tools', 'skills', 'workingDirectory']

const LOG_PREFIX = '[rust-fullstack]'
const MAX_SESSION_STATE = 100

function logWarn(...args) {
  console.warn(LOG_PREFIX, ...args)
}

function logInfo(...args) {
  console.info(LOG_PREFIX, ...args)
}

function remember(map, key, value) {
  if (map.size >= MAX_SESSION_STATE && !map.has(key)) {
    const oldest = map.keys().next().value
    map.delete(oldest)
  }
  map.set(key, value)
}

async function readStateFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeStateFile(file, value) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n')
  } catch (error) {
    logWarn('could not persist state', error?.message || error)
  }
}

function createSerialRunner() {
  let chain = Promise.resolve()
  return function runExclusive(fn) {
    const next = chain.then(fn, fn)
    chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}

function hasPriorActivation(agent, skillName) {
  const session = agent?.session
  if (!session || typeof session.seq !== 'number' || typeof session.eventAt !== 'function') return false
  for (let index = session.seq - 1; index >= 0; index -= 1) {
    let event
    try {
      event = session.eventAt(index)
    } catch {
      return false
    }
    if (event?.type !== 'user/message') continue
    const source = event.data?.source
    if (source?.kind === 'skill-invocation' && source.name === skillName) return true
  }
  return false
}

function parseArguments(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function makeActivationMessage({ skillName, text }) {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: 'skill-invocation',
      name: skillName,
      form: 'instructions',
      plugin: 'rust-fullstack',
      auto: true,
    },
  }
}

export async function apply(ctx, rawConfig) {
  const cfg = normalizeConfig(rawConfig)
  const basePaths = storePaths()
  const paths = {
    ...basePaths,
    globalSkillDir: globalSkillDirFor(cfg),
  }
  const state = {
    config: cfg,
    paths,
    sessionActivated: new Set(),
    sessionRustEvidence: new Map(),
    sessionLanguages: new Map(),
    runExclusive: createSerialRunner(),
    lastCheck: null,
    lastUpdate: null,
    activationCount: 0,
    ensureGlobal: async (force = false) => {
      if (!cfg.installGlobalSkill) return { ok: false, skipped: true, reason: 'installGlobalSkill=false' }
      return ensureGlobalSkill({
        sourceDir: bundledSkillDir(),
        targetDir: paths.globalSkillDir,
        backupRoot: paths.backupDir,
        force,
      })
    },
  }

  const persisted = await readStateFile(paths.statePath)
  state.lastCheck = typeof persisted.lastCheck === 'string' ? persisted.lastCheck : null
  state.lastUpdate = typeof persisted.lastUpdate === 'string' ? persisted.lastUpdate : null
  state.activationCount = Number.isFinite(persisted.activationCount) ? persisted.activationCount : 0

  const persist = () => {
    writeStateFile(paths.statePath, {
      schemaVersion: 1,
      lastCheck: state.lastCheck,
      lastUpdate: state.lastUpdate,
      activationCount: state.activationCount,
      updatedAt: new Date().toISOString(),
    })
  }

  const ensureInstalled = async () => {
    if (!cfg.installGlobalSkill) return null
    try {
      const result = await state.ensureGlobal(false)
      if (!result.ok) logWarn('global skill install completed with warnings', result.errors)
      else if (result.installed.length || result.updated.length) {
        logInfo(`global skill synced (${result.installed.length} new, ${result.updated.length} updated)`)
      }
      return result
    } catch (error) {
      logWarn('could not install global skill', error?.message || error)
      return null
    }
  }

  const autoRefresh = async () => {
    if (cfg.autoCheck === 'off') return
    const skillDir = paths.globalSkillDir
    const versions = await readVersions(skillDir)
    const lastCheck = versions.checkedAt || state.lastCheck
    if (!isStale(lastCheck, cfg.checkTtlHours)) return
    await state.runExclusive(async () => {
      await ensureInstalled()
      const result = await checkAndWrite({
        skillDir,
        sources: undefined,
        includeDocs: false,
      })
      state.lastCheck = result.versions.checkedAt
      persist()
      if (cfg.autoUpdate === 'skill') {
        try {
          const manifest = await readManifest(skillDir)
          const release = await getLatestPluginRelease(cfg.githubRepo)
          if (release.tag && release.tag !== manifest?.skillPack) {
            const pack = await downloadPack({ repo: cfg.githubRepo, ref: release.tag })
            const applied = await applyPack({
              pack,
              targetDir: skillDir,
              backupRoot: paths.backupDir,
              force: false,
            })
            state.lastUpdate = new Date().toISOString()
            persist()
            logInfo(`auto-updated skill pack to ${release.tag}`, applied.applied.length, 'files')
          }
        } catch (error) {
          logWarn('skill auto-update skipped', error?.message || error)
        }
      }
    }).catch((error) => {
      logWarn('auto freshness check failed', error?.message || error)
    })
  }

  await ensureInstalled()

  const tools = createTools(ctx, state)
  const registerEffect = typeof ctx.effect === 'function' ? ctx.effect.bind(ctx) : (fn) => fn()
  registerEffect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => {
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }, 'register rust-fullstack tools')

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || !cfg.autoActivate || !agent?.id) return decision
    try {
      const sessionId = agent.id
      if (state.sessionActivated.has(sessionId) || hasPriorActivation(agent, cfg.skillName)) {
        state.sessionActivated.add(sessionId)
        return decision
      }
      let cwd = process.cwd()
      try {
        cwd = await ctx.workingDirectory.ensure(agent, signal)
      } catch {
        // keep process.cwd()
      }
      const project = await scanProject(cwd)
      const messageDetection = detectRustInMessages(messages, project, cfg.activationThreshold)
      let evidence = messageDetection.rust ? messageDetection.evidence : []
      if (!evidence.length) {
        const remembered = state.sessionRustEvidence.get(sessionId)
        if (remembered?.length) evidence = remembered
      }
      if (!evidence.length) {
        const language = detectLanguageFromText(
          (Array.isArray(messages) ? messages : []).map((message) => extractMessageText(message)).join('\n'),
          project,
        )
        if (language.language) remember(state.sessionLanguages, sessionId, language.language)
        return decision
      }
      remember(state.sessionRustEvidence, sessionId, evidence)
      const skill = await loadSkill({ ctx, agent, cwd, skillName: cfg.skillName, signal, globalDir: paths.globalSkillDir })
      if (!skill) {
        logWarn('skill is not available in the catalog, global directory, or bundle')
        return decision
      }
      const activation = renderActivation({
        skill,
        project,
        evidence,
        maxChars: cfg.maxInjectionChars,
      })
      const injection = makeActivationMessage({ skillName: cfg.skillName, text: activation.text })
      state.sessionActivated.add(sessionId)
      state.activationCount += 1
      persist()
      return { ...decision, messages: [...(Array.isArray(decision.messages) ? decision.messages : []), injection] }
    } catch (error) {
      logWarn('activation failed', error?.message || error)
      return decision
    }
  })

  ctx.on('tools/pre-execute', async (execution, next) => {
    const args = parseArguments(execution?.arguments)
    if (execution?.name === 'rust_skill_update' && args?.dryRun !== true) {
      return {
        kind: 'ask',
        reason: 'rust_skill_update writes skill files into the global DSH skills directory.',
        displayReason: 'Allow the Rust skill update to modify global skill files?',
      }
    }
    try {
      if (execution?.agent?.id) {
        let cwd = process.cwd()
        try {
          cwd = await ctx.workingDirectory.ensure(execution.agent, execution.signal)
        } catch {
          // keep process.cwd()
        }
        const project = await scanProject(cwd)
        const toolDetection = detectRustInToolCall(execution.name, args, project, cfg.activationThreshold)
        if (toolDetection.rust) {
          remember(state.sessionRustEvidence, execution.agent.id, toolDetection.evidence)
        } else if (execution.name === 'write' || execution.name === 'edit') {
          const language = languageFromWritePath(args?.file_path)
          if (language) remember(state.sessionLanguages, execution.agent.id, language)
        }
      }
    } catch (error) {
      logWarn('tool detection failed', error?.message || error)
    }
    return next()
  })

  registerEffect(() => {
    const interval = checkIntervalMs(cfg.autoCheck)
    if (!interval) return () => {}
    let disposed = false
    let timer = null
    const tick = async () => {
      if (disposed) return
      try {
        await autoRefresh()
      } finally {
        if (!disposed) {
          timer = setTimeout(tick, interval)
          timer.unref?.()
        }
      }
    }
    timer = setTimeout(tick, 15_000)
    timer.unref?.()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
  }, 'rust-fullstack freshness scheduler')

  return () => {
    state.sessionActivated.clear()
    state.sessionRustEvidence.clear()
    state.sessionLanguages.clear()
  }
}
