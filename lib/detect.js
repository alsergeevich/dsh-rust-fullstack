import path from 'node:path'
import { detectLanguageFromPath, isIgnoredPath } from './project.js'

const WRITE_VERBS =
  /\b(?:напиши|добавь|исправь|реализуй|создай|перепиши|отрефактори|почини|сделай|implement|write|add|fix|refactor|create|build|debug|migrate|optimi[sz]e)\b/i
const RUST_WORD = /\brust\b/i
const RUST_FENCE = /```(?:rust|rs)\b/i
const RUST_FILE = /(?:^|[\s"'`(])(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[^\s"'`]+\.rs\b/i
const CARGO_COMMAND = /\bcargo\s+(?:build|run|test|check|clippy|fmt|new|add|watch|nextest|migrate|publish|doc|bench)\b/i
const RUSTC_COMMAND = /\brustc\b/i
const FRAMEWORK = /\b(?:axum|leptos|dioxus|sqlx)\b/i
const SQL_ONLY = /\b(?:postgres(?:ql)?|sqlite|psql|sqlite3)\b/i
const RUST_SYNTAX = [
  /\bfn\s+[A-Za-z_]\w*\s*\(/,
  /\bimpl\b/,
  /\buse\s+(?:std|crate|super)::/,
  /#\[derive\(/,
  /\bResult</,
  /\bOption</,
  /\bpub\s+(?:struct|enum|trait|fn|mod)\b/,
  /\basync\s+fn\b/,
]

const TOOL_NAMES_WRITE = new Set(['write', 'edit', 'apply_patch'])
const TOOL_NAMES_SHELL = new Set(['pwsh', 'bash', 'sh', 'shell', 'run_code'])

function addEvidence(evidence, score, id, detail) {
  if (evidence.some((item) => item.id === id)) return score
  evidence.push({ id, score, detail: String(detail).slice(0, 160) })
  return score
}

export function scoreRustText(input, project) {
  const text = String(input || '').slice(0, 50000)
  if (!text.trim()) return { score: 0, evidence: [] }
  const evidence = []
  let score = 0

  if (RUST_FENCE.test(text)) score = addEvidence(evidence, 100, 'rust_fence', 'rust code fence')
  if (RUST_FILE.test(text)) score = Math.max(score, addEvidence(evidence, 100, 'rust_file', '.rs file'))
  if (CARGO_COMMAND.test(text) || RUSTC_COMMAND.test(text)) {
    score = Math.max(score, addEvidence(evidence, 100, 'rust_command', 'cargo/rustc command'))
  }
  if (/\bCargo\.toml\b|\bbuild\.rs\b|\brust-toolchain(?:\.toml)?\b/i.test(text)) {
    score = Math.max(score, addEvidence(evidence, 80, 'cargo_manifest', 'Cargo manifest/toolchain'))
  }
  if (FRAMEWORK.test(text)) {
    score = Math.max(score, addEvidence(evidence, 70, 'rust_framework', 'Rust framework mention'))
  }
  if (RUST_WORD.test(text) && WRITE_VERBS.test(text)) {
    score = Math.max(score, addEvidence(evidence, 70, 'rust_write', 'Rust + write verb'))
  }
  const syntaxHits = RUST_SYNTAX.filter((pattern) => pattern.test(text)).length
  if (syntaxHits >= 2) {
    score = Math.max(score, addEvidence(evidence, 70, 'rust_syntax', `${syntaxHits} Rust syntax markers`))
  }
  if (project?.hasCargo && WRITE_VERBS.test(text)) {
    score = Math.max(score, addEvidence(evidence, 65, 'cargo_project_write', 'Rust project + change verb'))
  }
  if (RUST_WORD.test(text)) {
    score = Math.max(score, addEvidence(evidence, 35, 'rust_word', 'Rust word'))
  }
  if (SQL_ONLY.test(text) && !RUST_WORD.test(text) && !project?.hasCargo) {
    score = Math.max(score, addEvidence(evidence, 15, 'sql_only', 'database-only mention'))
  }

  return { score: Math.min(100, score), evidence: evidence.map((item) => item.detail) }
}

export function extractMessageText(message) {
  if (!message || typeof message !== 'object') return ''
  const content = Array.isArray(message.content) ? message.content : []
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

export function detectRustInMessages(messages, project, threshold = 60) {
  let best = 0
  const evidence = []
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.source?.kind !== 'user') continue
    const text = extractMessageText(message)
    if (!text) continue
    const result = scoreRustText(text, project)
    best = Math.max(best, result.score)
    for (const item of result.evidence) if (!evidence.includes(item)) evidence.push(item)
    if (best >= 100) break
  }
  return { rust: best >= threshold, score: best, evidence: evidence.slice(0, 6) }
}

export function detectRustInToolCall(name, args, project, threshold = 60) {
  const toolName = String(name || '')
  const strings = []
  collectStrings(args, strings, 0)
  const evidence = []
  let score = 0
  const joined = strings.join('\n').slice(0, 50000)

  for (const value of strings) {
    if (!value) continue
    if (/\.rs\b/i.test(value) && !isIgnoredPath(value)) {
      score = Math.max(score, addEvidence(evidence, 100, 'rust_file', '.rs file'))
    }
    if (/\bCargo\.toml\b|\bbuild\.rs\b|\brust-toolchain(?:\.toml)?\b/i.test(value)) {
      score = Math.max(score, addEvidence(evidence, 80, 'cargo_manifest', 'Cargo manifest/toolchain'))
    }
    if (CARGO_COMMAND.test(value) || RUSTC_COMMAND.test(value)) {
      score = Math.max(score, addEvidence(evidence, 100, 'rust_command', 'cargo/rustc command'))
    }
    if (toolName === 'dx' || /\b(?:trunk|dx)\s+(?:serve|build|watch|bundle|new)\b/i.test(value)) {
      score = Math.max(score, addEvidence(evidence, 90, 'rust_ui_cli', 'trunk/dx command'))
    }
    if (FRAMEWORK.test(value)) {
      score = Math.max(score, addEvidence(evidence, 70, 'rust_framework', 'Rust framework mention'))
    }
    if ((/\.rs\b/i.test(value) || (/\.toml\b/i.test(value) && /cargo/i.test(value))) && !isIgnoredPath(value)) {
      score = Math.max(score, addEvidence(evidence, 80, 'rust_manifest_path', 'Rust manifest path'))
    }
  }

  if (TOOL_NAMES_WRITE.has(toolName)) {
    const filePath = args && typeof args === 'object' ? args.file_path : null
    if (filePath && String(filePath).toLowerCase().endsWith('.rs') && !isIgnoredPath(filePath)) {
      score = Math.max(score, addEvidence(evidence, 100, 'write_rs', 'write/edit .rs'))
    }
    if (project?.hasCargo) {
      score = Math.max(score, addEvidence(evidence, 65, 'cargo_project_write', 'write into Rust project'))
    }
  }

  if (TOOL_NAMES_SHELL.has(toolName) && CARGO_COMMAND.test(joined)) {
    score = Math.max(score, addEvidence(evidence, 100, 'shell_cargo', 'shell cargo command'))
  }

  if (toolName === 'apply_patch' && /\.rs\b/i.test(joined) && !isIgnoredPath(joined)) {
    score = Math.max(score, addEvidence(evidence, 100, 'patch_rs', 'patch .rs'))
  }

  return { rust: score >= threshold, score: Math.min(100, score), evidence: evidence.map((item) => item.detail) }
}

function collectStrings(value, out, depth) {
  if (depth > 5 || out.length > 200) return
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1)
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out, depth + 1)
  }
}

export function detectLanguageFromText(text, project) {
  const rust = scoreRustText(text, project)
  if (rust.score >= 60) return { language: 'rust', score: rust.score, evidence: rust.evidence }
  if (/\b(?:typescript|tsx|\.ts)\b/i.test(text)) return { language: 'typescript', score: 50, evidence: ['typescript'] }
  if (/\b(?:python|\.py)\b/i.test(text)) return { language: 'python', score: 50, evidence: ['python'] }
  if (/\b(?:golang|\.go)\b/i.test(text)) return { language: 'go', score: 50, evidence: ['go'] }
  return { language: null, score: 0, evidence: [] }
}

export function languageFromWritePath(filePath) {
  return detectLanguageFromPath(path.normalize(String(filePath || '')))
}
