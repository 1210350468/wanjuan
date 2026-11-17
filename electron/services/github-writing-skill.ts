import type {
  GitHubRepositorySummary,
  GitHubRepositoryTarget,
  GitHubSkillCandidate,
  GitHubSkillRepositoryScan,
  GitHubWritingSkillLocation,
  WritingSkillBundledFile,
} from '../../src/shared/writing-skills'
import {
  collectReferencedPaths,
  inspectInstalledWritingSkill,
  inspectWritingSkillMarkdown,
  isSafeSkillPathSegment,
  MAX_WRITING_SKILL_BUNDLED_FILES,
  MAX_WRITING_SKILL_BYTES,
  parseGitHubWritingSkillUrl,
  resolveSkillReferencePath,
  WRITING_SKILL_NAME_PATTERN,
} from '../../src/shared/writing-skills'

/**
 * 从 GitHub 采集写作 Skill：读取 SKILL.md，按它引用的相对路径把 references 文本一并下载。
 * 只下载 Markdown 与纯文本；脚本、hook、子代理与工具调用不会被安装。
 */

const SKILL_MARKDOWN_NAME = 'skill.md'
const REPOSITORY_SCAN_LIMIT = 40
const REPOSITORY_SCAN_CONCURRENCY = 6
const REPOSITORY_JSON_MAX_BYTES = 8 * 1024 * 1024

export type GitHubSkillErrorCode = 'URL_INVALID' | 'REPOSITORY_UNAVAILABLE' | 'SKILL_MARKDOWN_MISSING' | 'SKILL_MARKDOWN_INVALID'

export class GitHubSkillError extends Error {
  constructor(readonly code: GitHubSkillErrorCode, message: string) {
    super(message)
    this.name = 'GitHubSkillError'
  }
}

function safeSegment(value: string, label: string): string {
  const decoded = decodeURIComponent(value)
  if (!isSafeSkillPathSegment(decoded)) {
    throw new GitHubSkillError('URL_INVALID', `Invalid GitHub ${label}`)
  }
  return decoded
}

function rawUrl(owner: string, repo: string, ref: string, repositoryPath: string): string {
  const segments = [owner, repo, ref, ...repositoryPath.split('/')].map(encodeURIComponent)
  return `https://raw.githubusercontent.com/${segments.join('/')}`
}

async function fetchText(url: string, accept: string, maxBytes = MAX_WRITING_SKILL_BYTES): Promise<string | undefined> {
  const response = await fetch(url, {
    headers: { Accept: accept, 'User-Agent': 'AI-Novel-Writer' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 404) return undefined
  if (!response.ok) {
    throw new GitHubSkillError('REPOSITORY_UNAVAILABLE', `GitHub 返回 ${response.status}`)
  }
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw new GitHubSkillError('SKILL_MARKDOWN_INVALID', '文件超过大小上限')
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new GitHubSkillError('SKILL_MARKDOWN_INVALID', '文件超过大小上限')
  }
  return text
}

/** SKILL.md 所在目录，作为 Skill 根目录。 */
function skillDirectory(location: GitHubWritingSkillLocation): string[] {
  return location.path.split('/').slice(0, -1)
}

async function fetchBundledFiles(
  location: GitHubWritingSkillLocation,
  ref: string,
  body: string,
): Promise<{ files: WritingSkillBundledFile[]; unbundled: string[] }> {
  const files: WritingSkillBundledFile[] = []
  const unbundled: string[] = []
  const included = new Set([SKILL_MARKDOWN_NAME])
  const queue = collectReferencedPaths(body).map(path => ({ path, base: [] as string[] }))
  // 有些仓库把 references 放在仓库根目录共用；Skill 目录里找不到时再按仓库根目录找一次。
  const skillRoot = skillDirectory(location).join('/')
  const readRepositoryText = async (relative: string): Promise<string | undefined> => {
    const inSkill = skillRoot ? `${skillRoot}/${relative}` : relative
    const direct = await fetchText(rawUrl(location.owner, location.repo, ref, inSkill), 'text/plain')
    if (direct !== undefined || inSkill === relative) return direct
    return fetchText(rawUrl(location.owner, location.repo, ref, relative), 'text/plain')
  }
  while (queue.length > 0 && files.length < MAX_WRITING_SKILL_BUNDLED_FILES) {
    const { path: reference, base } = queue.shift()!
    const relative = resolveSkillReferencePath(reference, base)
    if (!relative || included.has(relative.toLowerCase())) continue
    const content = await readRepositoryText(relative)
    if (content === undefined) {
      unbundled.push(reference.replace(/[#?].*$/, ''))
      continue
    }
    files.push({ path: relative, content })
    included.add(relative.toLowerCase())
    const directory = relative.split('/').slice(0, -1)
    queue.push(...collectReferencedPaths(content).map(path => ({ path, base: directory })))
  }
  return { files, unbundled: [...new Set(unbundled.filter(Boolean))] }
}

export interface LoadedGitHubWritingSkill {
  raw: string
  ref: string
  /** SKILL.md 的直链，安装后用于记录来源。 */
  resolvedUrl: string
  inspection: ReturnType<typeof inspectInstalledWritingSkill>
  files: WritingSkillBundledFile[]
  unbundled: string[]
}

/** 读取一个 GitHub 上的 Skill：SKILL.md 与它引用的附带文本。 */
export async function loadGitHubWritingSkill(sourceUrl: string): Promise<LoadedGitHubWritingSkill> {
  const location = parseGitHubWritingSkillUrl(sourceUrl)
  let ref = location.ref
  if (!ref) {
    const repository = await fetchText(
      `https://api.github.com/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}`,
      'application/vnd.github+json',
      1024 * 1024,
    )
    if (repository === undefined) throw new GitHubSkillError('REPOSITORY_UNAVAILABLE', 'GitHub 仓库不存在')
    let parsed: { default_branch?: unknown }
    try {
      parsed = JSON.parse(repository) as { default_branch?: unknown }
    } catch {
      throw new GitHubSkillError('REPOSITORY_UNAVAILABLE', 'GitHub 仓库信息无法解析')
    }
    if (typeof parsed.default_branch !== 'string' || !WRITING_SKILL_NAME_PATTERN.test(parsed.default_branch)) {
      throw new GitHubSkillError('REPOSITORY_UNAVAILABLE', 'GitHub 返回了不支持的默认分支')
    }
    ref = parsed.default_branch
  }

  const raw = await fetchText(rawUrl(location.owner, location.repo, ref, location.path), 'text/plain')
  if (raw === undefined) throw new GitHubSkillError('SKILL_MARKDOWN_MISSING', '仓库里没有这个 SKILL.md')

  const body = inspectWritingSkillMarkdown(raw).content
  const bundle = await fetchBundledFiles(location, ref, body)
  const inspection = inspectInstalledWritingSkill(
    raw,
    bundle.files.length > 0 ? { status: 'intact', files: bundle.files } : { status: 'none' },
  )
  return {
    raw,
    ref,
    resolvedUrl: rawUrl(location.owner, location.repo, ref, location.path),
    inspection,
    files: bundle.files,
    unbundled: bundle.unbundled,
  }
}

/** 仓库地址：owner/repo、仓库页链接，可带 /tree/{ref}/{path} 指定分支与子目录。 */
export function parseGitHubRepositoryInput(input: string): GitHubRepositoryTarget {
  const trimmed = input.trim()
  if (!trimmed) throw new GitHubSkillError('URL_INVALID', '请输入 GitHub 仓库地址')
  if (!trimmed.includes('://') && !trimmed.includes('@')) {
    const parts = trimmed.split('/').filter(Boolean)
    if (parts.length < 2 || parts.length > 2) throw new GitHubSkillError('URL_INVALID', '仓库地址写成 owner/repo，或者粘贴仓库页链接')
    return { owner: safeSegment(parts[0], 'owner'), repo: safeSegment(parts[1].replace(/\.git$/i, ''), 'repository') }
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new GitHubSkillError('URL_INVALID', 'GitHub 地址无效')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new GitHubSkillError('URL_INVALID', '只支持公开的 HTTPS GitHub 地址')
  }
  if (url.hostname !== 'github.com') throw new GitHubSkillError('URL_INVALID', '只支持 github.com 上的仓库')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) throw new GitHubSkillError('URL_INVALID', '地址里缺少仓库名')
  const target: GitHubRepositoryTarget = {
    owner: safeSegment(parts[0], 'owner'),
    repo: safeSegment(parts[1].replace(/\.git$/i, ''), 'repository'),
  }
  if (parts[2] === 'tree') {
    if (parts.length < 4) throw new GitHubSkillError('URL_INVALID', '地址里缺少分支名')
    target.ref = safeSegment(parts[3], 'ref')
    const prefix = parts.slice(4).filter(Boolean).map((part, index) => safeSegment(part, `path segment ${index + 1}`)).join('/')
    if (prefix) target.pathPrefix = prefix
  }
  return target
}

function skillPathsFromTree(paths: readonly string[], prefix: string | undefined): string[] {
  return paths
    .filter(path => path.toLowerCase() === SKILL_MARKDOWN_NAME || path.toLowerCase().endsWith(`/${SKILL_MARKDOWN_NAME}`))
    .filter(path => !prefix || path.startsWith(`${prefix}/`) || path === `${prefix}/SKILL.md`)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, REPOSITORY_SCAN_LIMIT)
}

function githubBlobUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://github.com/${owner}/${repo}/blob/${ref}/${path}`
}

/** 扫描仓库里的全部 SKILL.md，附上名称、说明与附带文本数量。 */
export async function scanGitHubSkillRepository(input: string): Promise<GitHubSkillRepositoryScan> {
  const target = parseGitHubRepositoryInput(input)
  const repository = await fetchText(
    `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`,
    'application/vnd.github+json',
    1024 * 1024,
  )
  if (repository === undefined) throw new GitHubSkillError('REPOSITORY_UNAVAILABLE', '仓库不存在，或不是公开仓库')
  let defaultBranch: string
  try {
    const parsed = JSON.parse(repository) as { default_branch?: unknown }
    if (typeof parsed.default_branch !== 'string' || !WRITING_SKILL_NAME_PATTERN.test(parsed.default_branch)) {
      throw new Error('unsupported branch')
    }
    defaultBranch = parsed.default_branch
  } catch {
    throw new GitHubSkillError('REPOSITORY_UNAVAILABLE', 'GitHub 返回了不支持的默认分支')
  }
  const ref = target.ref ?? defaultBranch

  const tree = await fetchText(
    `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    'application/vnd.github+json',
    REPOSITORY_JSON_MAX_BYTES,
  )
  if (tree === undefined) throw new GitHubSkillError('REPOSITORY_UNAVAILABLE', '读不到仓库的文件列表')
  let paths: string[]
  try {
    const parsed = JSON.parse(tree) as { tree?: Array<{ path?: unknown; type?: unknown }>; truncated?: boolean }
    paths = (parsed.tree ?? [])
      .filter(entry => entry.type === 'blob' && typeof entry.path === 'string')
      .map(entry => entry.path as string)
  } catch {
    throw new GitHubSkillError('REPOSITORY_UNAVAILABLE', '仓库文件列表无法解析')
  }

  const skillPaths = skillPathsFromTree(paths, target.pathPrefix)
  const pathSet = new Set(paths)
  const candidates: GitHubSkillCandidate[] = []
  let cursor = 0
  const worker = async () => {
    while (cursor < skillPaths.length) {
      const path = skillPaths[cursor++]
      const raw = await fetchText(rawUrl(target.owner, target.repo, ref, path), 'text/plain')
      if (raw === undefined) continue
      const inspection = inspectWritingSkillMarkdown(raw)
      const directory = path.split('/').slice(0, -1)
      let present = 0
      let missing = 0
      for (const reference of collectReferencedPaths(inspection.content)) {
        const relative = resolveSkillReferencePath(reference)
        if (!relative) continue
        if (pathSet.has([...directory, ...relative.split('/')].join('/'))) present += 1
        else missing += 1
      }
      candidates.push({
        path,
        sourceUrl: githubBlobUrl(target.owner, target.repo, ref, path),
        name: inspection.metadata.name,
        displayName: inspection.metadata.displayName,
        description: inspection.metadata.description,
        language: inspection.metadata.language,
        suggestedStage: inspection.suggestedStage,
        bundledReferences: present,
        missingReferences: missing,
        // 引用能补齐时不算阻断；其余原因（脚本、hook、子代理、工具、超长）下载附带文本也救不回来。
        blockingReasons: inspection.reasons.filter(reason => reason !== 'relative-reference' || missing > 0),
        utf8Bytes: inspection.utf8Bytes,
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(REPOSITORY_SCAN_CONCURRENCY, skillPaths.length) }, worker))
  const order = new Map(skillPaths.map((path, index) => [path, index]))
  candidates.sort((left, right) => (order.get(left.path) ?? 0) - (order.get(right.path) ?? 0))
  return { owner: target.owner, repo: target.repo, ref, candidates, truncated: skillPaths.length >= REPOSITORY_SCAN_LIMIT }
}

const REPOSITORY_SEARCH_LIMIT = 10
const REPOSITORY_SEARCH_TTL_MS = 5 * 60 * 1000
const repositorySearchCache = new Map<string, { at: number; repositories: GitHubRepositorySummary[] }>()

/** 按关键字搜 GitHub 仓库：用仓库搜索接口，结果带简介与最后更新时间。 */
export async function searchGitHubRepositories(query: string): Promise<GitHubRepositorySummary[]> {
  const trimmed = query.trim()
  if (!trimmed) throw new GitHubSkillError('URL_INVALID', '请输入要搜索的关键字')
  if (trimmed.length > 120) throw new GitHubSkillError('URL_INVALID', '关键字太长')
  const cached = repositorySearchCache.get(trimmed)
  if (cached && Date.now() - cached.at < REPOSITORY_SEARCH_TTL_MS) return cached.repositories

  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(trimmed)}&sort=stars&order=desc&per_page=${REPOSITORY_SEARCH_LIMIT}`
  const text = await fetchText(url, 'application/vnd.github+json', REPOSITORY_JSON_MAX_BYTES)
  if (text === undefined) throw new GitHubSkillError('REPOSITORY_UNAVAILABLE', '搜索没有返回结果')
  let parsed: { items?: Array<Record<string, unknown>>; message?: unknown }
  try {
    parsed = JSON.parse(text) as { items?: Array<Record<string, unknown>>; message?: unknown }
  } catch {
    throw new GitHubSkillError('REPOSITORY_UNAVAILABLE', '搜索结果的格式无法解析')
  }
  if (typeof parsed.message === 'string') {
    throw new GitHubSkillError('REPOSITORY_UNAVAILABLE', parsed.message === 'Validation Failed' ? '关键字不合法' : parsed.message)
  }
  const repositories: GitHubRepositorySummary[] = []
  for (const item of parsed.items ?? []) {
    const fullName = typeof item.full_name === 'string' ? item.full_name : ''
    const [owner, repo] = fullName.split('/')
    if (!owner || !repo) continue
    repositories.push({
      owner,
      repo,
      fullName,
      description: typeof item.description === 'string' ? item.description : '',
      stars: typeof item.stargazers_count === 'number' ? item.stargazers_count : 0,
      updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
      defaultBranch: typeof item.default_branch === 'string' ? item.default_branch : 'main',
    })
  }
  repositorySearchCache.set(trimmed, { at: Date.now(), repositories })
  return repositories
}
