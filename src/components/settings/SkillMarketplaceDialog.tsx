import { useCallback, useMemo, useState } from 'react'
import { Download, GitBranch, PackageSearch, RefreshCw, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Check } from '../ui/Check'
import { Notice } from '../ui/Notice'
import { confirm as confirmAction } from '../ui/Confirm'
import { ipc } from '../../services/ipc-client'
import { displayedErrorMessage } from '../../i18n/app-errors'
import { useLocaleStore } from '../../stores/locale-store'
import { RECOMMENDED_WRITING_SKILL_REPOS } from '../../shared/writing-skill-sources'
import {
  type GitHubRepositorySummary,
  type GitHubSkillCandidate,
  type GitHubSkillRepositoryScan,
  type WritingSkillStage,
} from '../../shared/writing-skills'

interface SkillMarketplaceDialogProps {
  open: boolean
  onClose: () => void
  /** 已安装的 Skill 名称，用于把列表里的条目标成已安装。 */
  installedNames: readonly string[]
  onInstalled: () => Promise<void>
}

const STAGE_COPY: Record<WritingSkillStage, readonly [string, string]> = {
  planning: ['设定与规划', 'Planning'],
  drafting: ['章节正文', 'Drafting'],
  review: ['AI 审稿', 'AI review'],
  refinement: ['修稿与润色', 'Revision'],
}

const REASON_COPY: Record<string, readonly [string, string]> = {
  'relative-reference': ['引用了仓库里没有的文件', 'References files missing from the repository'],
  'script-dependency': ['依赖脚本', 'Needs scripts'],
  'hook-dependency': ['依赖 hook', 'Needs hooks'],
  'subagent-dependency': ['依赖子代理', 'Needs subagents'],
  'tool-dependency': ['依赖工具调用', 'Needs tool calls'],
  'content-too-large': ['合并后超过 64 KiB', 'Larger than 64 KiB after merging'],
  'bundle-damaged': ['附带文件已损坏', 'Bundled files are damaged'],
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`
}

interface InstallOutcome {
  name: string
  ok: boolean
  detail: string
}

/** Skill 超市：扫描 GitHub 仓库里的全部 SKILL.md，勾选后批量安装。 */
export default function SkillMarketplaceDialog({ open, onClose, installedNames, onInstalled }: SkillMarketplaceDialogProps) {
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const [repository, setRepository] = useState('')
  const [repoQuery, setRepoQuery] = useState('')
  const [repositories, setRepositories] = useState<GitHubRepositorySummary[]>([])
  const [searchingRepos, setSearchingRepos] = useState(false)
  const [scan, setScan] = useState<GitHubSkillRepositoryScan | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')
  const [outcomes, setOutcomes] = useState<InstallOutcome[]>([])

  const installed = useMemo(() => new Set(installedNames.map(name => name.toLowerCase())), [installedNames])

  const runScan = useCallback(async (input: string) => {
    const target = input.trim()
    if (!target) {
      setError(text('请输入 GitHub 仓库地址', 'Enter a GitHub repository address'))
      return
    }
    setScanning(true)
    setError('')
    setOutcomes([])
    try {
      const response = await ipc.invoke('skills:scan-repo', target)
      if (!response.success || !response.scan) {
        setScan(null)
        setSelected([])
        setError(response.error ?? text('仓库扫描失败', 'Repository scan failed'))
        return
      }
      setScan(response.scan)
      setSelected([])
      if (response.scan.candidates.length === 0) {
        setError(text('这个仓库里没有找到 SKILL.md', 'No SKILL.md was found in this repository'))
      }
    } catch (cause) {
      setScan(null)
      setSelected([])
      setError(displayedErrorMessage(locale, cause))
    } finally {
      setScanning(false)
    }
  }, [locale, text])

  /** 按关键字搜仓库：结果每次现搜，带仓库简介与最后更新时间。 */
  const searchRepositories = useCallback(async () => {
    const query = repoQuery.trim()
    if (!query) {
      setError(text('请输入要搜索的关键字', 'Enter a keyword to search'))
      return
    }
    setSearchingRepos(true)
    setError('')
    try {
      const response = await ipc.invoke('skills:search-repos', query)
      if (!response.success || !response.repositories) {
        setRepositories([])
        setError(response.error ?? text('仓库搜索失败', 'Repository search failed'))
        return
      }
      setRepositories(response.repositories)
      if (response.repositories.length === 0) {
        setError(text('没有搜到仓库，换个关键字试试', 'No repository matched; try another keyword'))
      }
    } catch (cause) {
      setRepositories([])
      setError(displayedErrorMessage(locale, cause))
    } finally {
      setSearchingRepos(false)
    }
  }, [locale, repoQuery, text])

  const toggle = (candidate: GitHubSkillCandidate) => {    setSelected(previous => previous.includes(candidate.sourceUrl)
      ? previous.filter(url => url !== candidate.sourceUrl)
      : [...previous, candidate.sourceUrl])
  }

  const installSelected = async () => {
    if (!scan || selected.length === 0) return
    const chosen = scan.candidates.filter(candidate => selected.includes(candidate.sourceUrl))
    const confirmed = await confirmAction(
      text(
        `安装 ${chosen.length} 个 Skill？安装时会逐个重新下载 SKILL.md 和它引用的文本，并核对内容。`,
        `Install ${chosen.length} skills? Each SKILL.md and the text it references will be downloaded again and verified.`,
      ),
      { title: text('批量安装写作 Skill', 'Install writing skills') },
    )
    if (!confirmed) return
    setInstalling(true)
    setError('')
    const results: InstallOutcome[] = []
    try {
      for (const candidate of chosen) {
        const name = candidate.displayName || candidate.name
        const inspected = await ipc.invoke('skills:inspect-github', candidate.sourceUrl)
        if (!inspected.success || !inspected.inspection) {
          results.push({ name, ok: false, detail: inspected.error ?? text('检查失败', 'Inspection failed') })
          setOutcomes([...results])
          continue
        }
        const inspection = inspected.inspection
        if (!inspection.compatible) {
          results.push({
            name,
            ok: false,
            detail: text(
              `依赖脚本、hook 或子代理，不能作为提示词安装（${inspection.reasons.join('、')}）`,
              `Depends on scripts, hooks, or subagents and cannot be installed as a prompt (${inspection.reasons.join(', ')})`,
            ),
          })
          setOutcomes([...results])
          continue
        }
        const result = await ipc.invoke('skills:install-github', candidate.sourceUrl)
        results.push({
          name,
          ok: result.success,
          detail: result.success
            ? text(
                `已安装${inspection.bundledFiles?.length ? `，并入 ${inspection.bundledFiles.length} 份附带文本` : ''}`,
                `Installed${inspection.bundledFiles?.length ? ` with ${inspection.bundledFiles.length} reference files` : ''}`,
              )
            : result.error ?? text('安装失败', 'Installation failed'),
        })
        setOutcomes([...results])
      }
      await onInstalled()
    } catch (cause) {
      setError(displayedErrorMessage(locale, cause))
    } finally {
      setInstalling(false)
      setSelected([])
    }
  }

  const succeeded = outcomes.filter(outcome => outcome.ok).length

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) onClose() }}>
      <DialogContent className="max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageSearch size={18} className="text-[var(--color-accent)]" />
            {text('写作 Skill 超市', 'Writing skill marketplace')}
          </DialogTitle>
          <DialogDescription>
            {text(
              '扫描 GitHub 仓库里的全部 SKILL.md，勾选后一次装上。安装时会连同它引用的 references 文本一起下载；脚本、hook、子代理与工具调用不会被安装，这类 Skill 会在安装前被判定为不兼容。',
              'Scan every SKILL.md in a GitHub repository and install the ones you pick in one go. The text each skill references is downloaded with it; scripts, hooks, subagents, and tool calls are not installed, and skills that need them are rejected before installation.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 max-h-[62vh] overflow-y-auto">
          <div>
            <Label htmlFor="skill-marketplace-repo">{text('GitHub 仓库', 'GitHub repository')}</Label>
            <div className="flex gap-2">
              <Input
                id="skill-marketplace-repo"
                value={repository}
                placeholder="owner/repo，或 https://github.com/owner/repo"
                onChange={event => setRepository(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') void runScan(repository) }}
              />
              <Button type="button" variant="secondary" disabled={scanning} onClick={() => void runScan(repository)}>
                <RefreshCw size={13} aria-hidden className={scanning ? 'animate-spin' : ''} />
                {text('扫描', 'Scan')}
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor="skill-marketplace-query">{text('按关键字找仓库', 'Find repositories by keyword')}</Label>
            <div className="flex gap-2">
              <Input
                id="skill-marketplace-query"
                value={repoQuery}
                placeholder={text('例如：网文 写作 skill、去AI味', 'For example: web novel writing skill')}
                onChange={event => setRepoQuery(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') void searchRepositories() }}
              />
              <Button type="button" variant="secondary" disabled={searchingRepos} onClick={() => void searchRepositories()}>
                <Search size={13} aria-hidden className={searchingRepos ? 'animate-pulse' : ''} />
                {text('找仓库', 'Find')}
              </Button>
            </div>
            {repositories.length > 0 && (
              <ul className="mt-2 space-y-1" aria-label={text('找到的仓库', 'Repositories found')}>
                {repositories.map(item => (
                  <li key={item.fullName} className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                        {item.fullName}
                        <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                          {text(`${item.stars} 星`, `${item.stars} stars`)}
                          {item.updatedAt ? text(` · ${new Date(item.updatedAt).toLocaleDateString('zh-CN')} 更新`, ` · updated ${new Date(item.updatedAt).toLocaleDateString('en-US')}`) : ''}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--color-text-muted)]">
                        {item.description || text('这个仓库没有写简介。', 'This repository has no description.')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={scanning}
                      onClick={() => {
                        setRepository(item.fullName)
                        void runScan(item.fullName)
                      }}
                    >
                      {text('看技能', 'View skills')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <span className="text-xs text-[var(--color-text-secondary)]">{text('推荐来源', 'Recommended sources')}</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {RECOMMENDED_WRITING_SKILL_REPOS.map(source => (
                <Button
                  key={source.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={scanning}
                  title={`${source.description}\n${source.verified}`}
                  onClick={() => {
                    setRepository(`${source.owner}/${source.repo}`)
                    void runScan(`${source.owner}/${source.repo}`)
                  }}
                >
                  <GitBranch size={13} aria-hidden />
                  {source.name}
                </Button>
              ))}
            </div>
          </div>

          {scanning && (
            <p className="text-xs text-[var(--color-text-secondary)]">
              {text('正在读取仓库里的 SKILL.md…', 'Reading SKILL.md files in the repository…')}
            </p>
          )}
          {error && <Notice tone="warn" title={text('没有读出来', 'Could not read it')}>{error}</Notice>}

          {scan && scan.candidates.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {text(
                    `${scan.owner}/${scan.repo} · ${scan.candidates.length} 个 Skill`,
                    `${scan.owner}/${scan.repo} · ${scan.candidates.length} skills`,
                  )}
                  {scan.truncated && text('（只列出前 40 个）', ' (first 40 only)')}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="text"
                    size="sm"
                    onClick={() => setSelected(scan.candidates
                      .filter(candidate => candidate.blockingReasons.length === 0)
                      .filter(candidate => !installed.has(candidate.name.toLowerCase()))
                      .map(candidate => candidate.sourceUrl))}
                  >
                    {text('全选可安装', 'Select installable')}
                  </Button>
                  <Button type="button" variant="text" size="sm" onClick={() => setSelected([])}>{text('清空', 'Clear')}</Button>
                </div>
              </div>
              <ul className="space-y-2" aria-label={text('仓库里的 Skill', 'Skills in this repository')}>
                {scan.candidates.map(candidate => {
                  const already = installed.has(candidate.name.toLowerCase())
                  const blocked = candidate.blockingReasons.length > 0
                  const picked = selected.includes(candidate.sourceUrl)
                  return (
                    <li key={candidate.sourceUrl}>
                      <Check
                        checked={already || picked}
                        disabled={already || blocked}
                        onChange={() => toggle(candidate)}
                        label={(
                          <span className="flex flex-col gap-0.5">
                            <span className="font-medium">
                              {candidate.displayName ?? candidate.name}
                              {already && <span className="ml-2 text-[0.68rem] text-[var(--color-text-muted)]">{text('已安装', 'Installed')}</span>}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                              {[
                                candidate.suggestedStage ? text(STAGE_COPY[candidate.suggestedStage][0], STAGE_COPY[candidate.suggestedStage][1]) : '',
                                candidate.language,
                                text(`${candidate.bundledReferences} 份附带文本`, `${candidate.bundledReferences} reference files`),
                                formatBytes(candidate.utf8Bytes),
                              ].filter(Boolean).join('｜')}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                              {candidate.description}
                            </span>
                            {blocked && (
                              <span className="text-xs text-[var(--color-warning-text)]">
                                {text('不能安装：', 'Cannot install: ')}
                                {candidate.blockingReasons.map(reason => {
                                  const copy = REASON_COPY[reason]
                                  return copy ? text(copy[0], copy[1]) : reason
                                }).join(text('、', ', '))}
                              </span>
                            )}
                          </span>
                        )}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {outcomes.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                {text(`安装结果：成功 ${succeeded} 个，失败 ${outcomes.length - succeeded} 个`, `Results: ${succeeded} installed, ${outcomes.length - succeeded} failed`)}
              </p>
              <ul className="space-y-1">
                {outcomes.map(outcome => (
                  <li key={`${outcome.name}-${outcome.detail}`} className="text-xs leading-5" style={{ color: outcome.ok ? 'var(--color-success-text)' : 'var(--color-warning-text)' }}>
                    {outcome.name}：{outcome.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>{text('关闭', 'Close')}</Button>
          <Button
            type="button"
            variant="primary"
            disabled={installing || selected.length === 0}
            onClick={() => void installSelected()}
          >
            <Download size={13} aria-hidden />
            {installing
              ? text('正在安装…', 'Installing…')
              : text(`安装所选（${selected.length}）`, `Install selected (${selected.length})`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
