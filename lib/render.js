function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function resourceLines(resourceBase) {
  if (!resourceBase) return []
  if (resourceBase.kind === 'directory') {
    return [
      `Base directory for this skill: ${resourceBase.path}`,
      'Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.',
    ]
  }
  if (resourceBase.kind === 'url') {
    return [`Skill resources: ${resourceBase.url}`, 'Load referenced resources only as needed.']
  }
  if (resourceBase.kind === 'opaque' && resourceBase.description) {
    return [`Skill resources: ${resourceBase.description}`]
  }
  return []
}

export function renderSkillContent(skill) {
  const name = escapeAttr(skill?.name || 'rust-fullstack-elite')
  const body = String(skill?.content || '').trim()
  const resources = resourceLines(skill?.resourceBase)
  const resourceBlock = resources.length
    ? `<skill_resources>\n${resources.join('\n')}\n</skill_resources>\n\n`
    : ''
  return `<skill_content name="${name}">\n${resourceBlock}<skill_instructions>\n${body}\n</skill_instructions>\n</skill_content>`
}

export function compactProject(project) {
  if (!project || project.hasCargo !== true) {
    return { hasCargo: false, root: null }
  }
  return {
    hasCargo: true,
    root: project.root,
    workspace: project.workspace,
    packageName: project.packageName,
    edition: project.edition,
    rustVersion: project.rustVersion,
    toolchain: project.toolchain,
    frameworks: project.frameworks,
    databases: project.databases,
    versions: project.versions,
    migrations: project.migrations,
    rustFileCount: project.rustFileCount,
  }
}

function projectLines(project) {
  const compact = compactProject(project)
  const lines = []
  for (const [key, value] of Object.entries(compact)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    if (Array.isArray(value)) {
      if (value.length) lines.push(`${key}: ${value.join(', ')}`)
    } else if (typeof value === 'object') {
      const entries = Object.entries(value)
      if (entries.length) lines.push(`${key}: ${entries.map(([k, v]) => `${k}=${v}`).join(', ')}`)
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  return lines
}

export function renderActivation({ skill, project, evidence = [], maxChars = 24000 }) {
  const evidenceText = evidence.length ? evidence.join('; ') : 'rust context'
  const preamble = [
    'Rust work detected in this session. The rust-fullstack-elite skill is now active.',
    `Evidence: ${evidenceText}.`,
    'Use this skill as the working standard. For version-specific APIs, consult official documentation before asserting details. Do not rewrite the project into another stack unless the user asks.',
  ].join(' ')

  const context = projectLines(project)
  const contextBlock = context.length
    ? `<rust_project_context>\n${context.join('\n')}\n</rust_project_context>\n\n`
    : ''

  const body = String(skill?.content || '').trim()
  const fixed = preamble.length + contextBlock.length + 220
  const budget = Math.max(800, maxChars - fixed)
  let bodyText = body
  let truncated = false
  if (bodyText.length > budget) {
    const cut = bodyText.lastIndexOf('\n', budget)
    bodyText = bodyText.slice(0, cut > budget * 0.5 ? cut : budget).trimEnd()
    truncated = true
  }
  const truncationNote = truncated
    ? '\n\n[Activation truncated to fit the injection budget. Load the full skill with the `skill` tool before relying on details that are missing here.]'
    : ''

  const skillBlock = renderSkillContent({
    name: skill?.name || 'rust-fullstack-elite',
    resourceBase: skill?.resourceBase,
    content: bodyText + truncationNote,
  })

  return { text: `${preamble}\n\n${contextBlock}${skillBlock}`, truncated }
}

export function textBlocks(text) {
  return [{ type: 'text', text: String(text) }]
}
