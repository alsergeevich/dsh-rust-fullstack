import path from 'node:path'
import { PACKAGE_VERSION, SKILL_NAME } from './config.js'
import { checkAndWrite, defaultSources, isStale, readVersions } from './freshness.js'
import { fetchDocs } from './docs.js'
import { scanProject } from './project.js'
import {
  applyPack,
  bundledSkillDir,
  downloadPack,
  getLatestPluginRelease,
  globalSkillStatus,
  isGeneratedFile,
  readManifest,
} from './skill-store.js'

const OUTPUT_SCHEMA = Object.freeze({ type: 'object', additionalProperties: true })
const TEXT_BLOCK = (text) => [{ type: 'text', text: String(text) }]

function textOutput(text) {
  return { text: String(text) }
}

function card(title, args, kind = 'other') {
  return { card: 'generic', title, kind, rawInput: args }
}

function fmt(value) {
  if (value === undefined || value === null || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    return entries.length ? entries.map(([key, val]) => `${key}=${val}`).join(', ') : '—'
  }
  return String(value)
}

function table(items) {
  const rows = ['| Technology | Latest | MSRV | Notes |', '|---|---:|---:|---|']
  for (const item of items || []) {
    if (item.kind !== 'tech') continue
    rows.push(`| ${item.label} | ${item.status === 'ok' ? item.version || '?' : 'error'} | ${item.msrv || '—'} | ${item.note || item.error || ''} |`)
  }
  return rows.join('\n')
}

function projectSummary(project) {
  if (!project?.hasCargo) return 'No Cargo.toml found from the session directory.'
  const lines = [
    `Cargo root: ${project.root}`,
    `Package: ${fmt(project.packageName)}`,
    `Edition: ${fmt(project.edition)} · rust-version: ${fmt(project.rustVersion)} · toolchain: ${fmt(project.toolchain)}`,
    `Frameworks: ${fmt(project.frameworks)}`,
    `Databases: ${fmt(project.databases)}`,
    `Dependencies: ${fmt(project.versions)}`,
    `Migrations: ${fmt(project.migrations)} · Rust files: ${project.rustFileCount ?? '—'}`,
  ]
  return lines.join('\n')
}

function errorText(error, fallback = 'operation failed') {
  return `ERROR: ${error?.message || (typeof error === 'string' ? error : fallback)}`
}

async function cwdFor(ctx, exec) {
  if (exec?.agent) {
    try {
      return await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    } catch {
      // fall through
    }
  }
  return process.cwd()
}

async function readSkillDir(state) {
  const global = await globalSkillStatus({ targetDir: state.paths.globalSkillDir })
  if (global.exists) return state.paths.globalSkillDir
  return bundledSkillDir()
}

function expandSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return defaultSources()
  const out = []
  for (const value of sources) {
    const source = String(value || '').trim()
    if (!source || source === 'all') return defaultSources()
    if (source === 'docs') {
      out.push('docs:rust', 'docs:axum', 'docs:leptos', 'docs:dioxus', 'docs:sqlx', 'docs:postgres', 'docs:sqlite')
      continue
    }
    out.push(source)
  }
  return [...new Set(out)]
}

export function createTools(ctx, state) {
  const { config: cfg } = state

  const statusTool = {
    name: 'rust_skill_status',
    description:
      'Report the installed Rust full-stack skill, its freshness metadata, optional global-skill drift, and the current Cargo project. Read-only; does not use the network.',
    parameters: {
      type: 'object',
      properties: {
        includeProject: { type: 'boolean', description: 'Also scan the current Cargo project. Default true.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => TEXT_BLOCK(value.text || ''),
    },
    presentCall: (args) => card('Rust full-stack status', args, 'read'),
    async execute(args, exec) {
      try {
        const includeProject = args?.includeProject !== false
        const skillDir = await readSkillDir(state)
        const versions = await readVersions(skillDir)
        const global = await globalSkillStatus({ targetDir: state.paths.globalSkillDir })
        const manifest = global.manifest || (await readManifest(skillDir))
        const project = includeProject ? await scanProject(await cwdFor(ctx, exec)) : null
        const stale = isStale(versions.checkedAt || global.manifest?.updatedAt, cfg.checkTtlHours)
        const value = {
          ok: true,
          plugin: {
            name: '@alsergeevich/dsh-rust-fullstack',
            version: PACKAGE_VERSION,
            repository: cfg.githubRepo,
          },
          skill: {
            name: cfg.skillName || SKILL_NAME,
            version: versions.skillVersion || manifest?.skillVersion || null,
            pack: manifest?.skillPack || null,
            directory: skillDir,
            globalDirectory: state.paths.globalSkillDir,
            source: global.exists ? 'global' : 'bundled',
          },
          global: {
            ok: global.ok,
            exists: global.exists,
            userModified: global.userModified.filter((rel) => !isGeneratedFile(rel)),
            missing: global.missing,
            extra: global.extra,
          },
          freshness: {
            checkedAt: versions.checkedAt || null,
            stale,
            ttlHours: cfg.checkTtlHours,
            items: versions.items || [],
            technologies: versions.technologies || {},
          },
          project: includeProject ? project : null,
          activation: { autoActivate: cfg.autoActivate, activationThreshold: cfg.activationThreshold },
          config: cfg,
        }
        const lines = [
          `Rust Full-Stack plugin v${PACKAGE_VERSION}`,
          `Repository: ${cfg.githubRepo}`,
          `Skill: ${value.skill.name} v${fmt(value.skill.version)} (${value.skill.source})`,
          `Global skill: ${global.exists ? 'installed' : 'missing'} at ${state.paths.globalSkillDir}`,
          global.userModified.filter((rel) => !isGeneratedFile(rel)).length
            ? `User-modified files: ${global.userModified.filter((rel) => !isGeneratedFile(rel)).join(', ')}`
            : 'User-modified files: none',
          '',
          `Freshness: ${versions.checkedAt || 'never checked'}${stale ? ' (stale)' : ' (fresh)'}`,
          table(versions.items),
          '',
          project ? projectSummary(project) : 'Project scan skipped.',
        ]
        return { ...value, text: lines.join('\n') }
      } catch (error) {
        return { ok: false, error: error?.message || String(error), text: errorText(error) }
      }
    },
  }

  const checkTool = {
    name: 'rust_skill_check',
    description:
      'Check the latest stable Rust, Axum, Leptos, Dioxus, SQLx, Tokio, Tower-HTTP, CLI crates, PostgreSQL, and SQLite versions from official sources. Writes the skill versions.json/versions.md files. Optionally verifies official documentation URLs.',
    parameters: {
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Source ids, for example ["rust","crates:axum","crates:leptos","postgres","sqlite","docs"]. Omit to check all technologies.',
        },
        includeDocs: { type: 'boolean', description: 'Also verify the official documentation URLs. Default false.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => TEXT_BLOCK(value.text || ''),
    },
    presentCall: (args) => card('Check Rust stack freshness', args, 'read'),
    async execute(args, exec) {
      try {
        const sources = expandSources(args?.sources)
        const includeDocs = args?.includeDocs === true
        return await state.runExclusive(async () => {
          const skillDir = await readSkillDir(state)
          const result = await checkAndWrite({
            skillDir,
            sources,
            includeDocs,
            signal: exec?.signal,
          })
          const failed = result.versions.items.filter((item) => item.status !== 'ok')
          const lines = [
            `Checked ${result.versions.items.length} source(s) at ${result.versions.checkedAt}.`,
            `Status: ${failed.length ? `${failed.length} source(s) failed` : 'all selected sources reachable'}.`,
            '',
            table(result.versions.items),
            failed.length ? `\nFailures:\n${failed.map((item) => `- ${item.label}: ${item.error || 'unavailable'}`).join('\n')}` : '',
          ]
          return {
            ok: failed.length === 0,
            checkedAt: result.versions.checkedAt,
            items: result.versions.items,
            versions: result.versions,
            skillDir,
            failed,
            text: lines.join('\n'),
          }
        })
      } catch (error) {
        return { ok: false, error: error?.message || String(error), text: errorText(error) }
      }
    },
  }

  const updateTool = {
    name: 'rust_skill_update',
    description:
      'Download and install the latest rust-fullstack-elite skill pack from the plugin GitHub release. Verifies the pack index, SHA-256 of every file, size limits, and backs up the current global skill. Never executes remote code; only Markdown/JSON/text files are accepted.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Release tag or branch, for example v0.1.0. Defaults to the latest GitHub release.' },
        force: { type: 'boolean', description: 'Overwrite locally modified skill files. Default false.' },
        dryRun: { type: 'boolean', description: 'Fetch and validate the pack without writing. Default false.' },
        includePlugin: { type: 'boolean', description: 'Also report whether a newer plugin release exists. Default true.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => TEXT_BLOCK(value.text || ''),
    },
    presentCall: (args) => card('Update Rust full-stack skill', args, 'write'),
    async execute(args, exec) {
      try {
        return await state.runExclusive(async () => {
          const config = state.config
          const includePlugin = args?.includePlugin !== false
          let release = null
          if (includePlugin) {
            try {
              release = await getLatestPluginRelease(config.githubRepo, { signal: exec?.signal })
            } catch {
              release = null
            }
          }
          const pack = await downloadPack({
            repo: config.githubRepo,
            ref: args?.ref,
            signal: exec?.signal,
          })
          const pluginUpdateAvailable = Boolean(release && release.tag !== `v${PACKAGE_VERSION}` && release.tag !== PACKAGE_VERSION)
          if (args?.dryRun === true) {
            return {
              ok: true,
              dryRun: true,
              tag: pack.tag,
              skillVersion: pack.index.skillVersion,
              fileCount: pack.index.files.length,
              release,
              pluginUpdateAvailable,
              text: [
                `Dry run: skill pack ${pack.tag} validated (${pack.index.files.length} files, skill version ${pack.index.skillVersion}).`,
                release ? `Latest plugin release: ${release.tag}` : 'Plugin release lookup unavailable.',
                pluginUpdateAvailable ? 'A newer plugin release exists. This plugin does not self-replace its JavaScript; update it with DSH plugin_manager.' : '',
              ].filter(Boolean).join('\n'),
            }
          }
          const applied = await applyPack({
            pack,
            targetDir: state.paths.globalSkillDir,
            backupRoot: state.paths.backupDir,
            force: args?.force === true,
          })
          const lines = [
            `Applied skill pack ${pack.tag} (skill version ${pack.index.skillVersion}).`,
            `Files written: ${applied.applied.length}; skipped user-modified: ${applied.skippedUserModified.length}.`,
            applied.backupPath ? `Backup: ${applied.backupPath}` : 'Backup: none',
            applied.errors.length ? `Errors:\n${applied.errors.map((item) => `- ${item}`).join('\n')}` : '',
            release ? `Latest plugin release: ${release.tag}` : '',
            pluginUpdateAvailable ? 'A newer plugin release exists; update the plugin package with DSH plugin_manager.' : '',
          ].filter(Boolean)
          return {
            ok: applied.ok,
            tag: pack.tag,
            skillVersion: pack.index.skillVersion,
            applied: applied.applied,
            skippedUserModified: applied.skippedUserModified,
            backupPath: applied.backupPath,
            errors: applied.errors,
            release,
            pluginUpdateAvailable,
            text: lines.join('\n'),
          }
        })
      } catch (error) {
        return { ok: false, error: error?.message || String(error), text: errorText(error) }
      }
    },
  }

  const docsTool = {
    name: 'rust_docs',
    description:
      'Fetch and extract text from one of a strict allowlist of official Rust, Axum, Leptos, Dioxus, SQLx, PostgreSQL, SQLite, Tokio, and Tower-HTTP documentation pages. Caches pages for 24 hours and returns a bounded excerpt with its source URL.',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'rust | axum | leptos | dioxus | sqlx | postgres | sqlite | tokio | tower | testing | security',
        },
        url: { type: 'string', description: 'An official documentation URL on the allowlist. Overrides topic.' },
        maxChars: { type: 'integer', description: 'Excerpt length, 1000-30000. Default 12000.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => TEXT_BLOCK(value.text || ''),
    },
    presentCall: (args) => card('Read official Rust docs', args, 'read'),
    async execute(args, exec) {
      try {
        if (!args?.topic && !args?.url) {
          return { ok: false, error: 'topic_or_url_required', text: 'Provide topic or url.' }
        }
        const maxChars = Math.min(30000, Math.max(1000, Number(args?.maxChars) || 12000))
        const result = await fetchDocs({
          topic: args?.topic,
          url: args?.url,
          maxChars,
          cacheDir: state.paths.cacheDir,
          cacheTtlHours: cfg.docsCacheTtlHours,
          signal: exec?.signal,
        })
        if (!result.ok) {
          return { ...result, text: `Documentation fetch failed: ${result.error}` }
        }
        const lines = [
          `# ${result.title || result.url}`,
          `${result.url}${result.cached ? ' (cached)' : ''} · fetched ${result.fetchedAt}`,
          '',
          result.excerpt,
          result.truncated ? '\n[Excerpt truncated. Use a larger maxChars or fetch a more specific official page.]' : '',
          `\nSource: ${result.url}`,
        ]
        return { ...result, text: lines.join('\n') }
      } catch (error) {
        return { ok: false, error: error?.message || String(error), text: errorText(error) }
      }
    },
  }

  const projectTool = {
    name: 'rust_project_scan',
    description:
      'Scan a Cargo project and report package metadata, workspace layout, frameworks, database crates, dependency versions from Cargo.lock, rust-toolchain, migrations, and Rust file count. Read-only and bounded.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project directory; defaults to the session working directory.' },
        maxFiles: { type: 'integer', description: 'Maximum Rust files to count, 100-5000. Default 2000.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => TEXT_BLOCK(value.text || ''),
    },
    presentCall: (args) => card('Scan Rust project', args, 'read'),
    async execute(args, exec) {
      try {
        const base = await cwdFor(ctx, exec)
        const target = args?.path ? path.resolve(base, args.path) : base
        const maxFiles = Math.min(5000, Math.max(100, Number(args?.maxFiles) || 2000))
        const project = await scanProject(target, { maxFiles })
        return {
          ok: true,
          project,
          text: `Project scan: ${target}\n\n${projectSummary(project)}`,
        }
      } catch (error) {
        return { ok: false, error: error?.message || String(error), text: errorText(error) }
      }
    },
  }

  return [statusTool, checkTool, updateTool, docsTool, projectTool]
}
