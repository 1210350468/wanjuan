import { useCallback, useMemo, useState } from 'react'
import { BookMarked, Library, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Textarea } from '../ui/Textarea'
import { Notice } from '../ui/Notice'
import { ipc } from '../../services/ipc-client'
import { displayedErrorMessage } from '../../i18n/app-errors'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { projectSessionContextFromProject } from '../../shared/project-session-context'
import { pluralEn } from '../../shared/plural-en'
import {
  buildFanqieFusionBrief,
  buildFanqieSelectionInsight,
  FANQIE_FUSION_MAX_BOOKS,
  scoreFanqieBook,
  suggestFanqieBundle,
  type FanqieBookSummary,
  type FanqieRankPage,
  type FanqieSearchResult,
  type FanqieSelectionInsight,
} from '../../shared/fanqie'
import { routeModelId } from '../../services/model-routing'
import type { ProjectDirectoryGrant } from '../../shared/ipc-channels'
import { startConfigGeneration } from './config-generation'
import type { NovelConfig } from '../../shared/ipc-channels'

interface FanqieLibraryDialogProps {
  open: boolean
  onClose: () => void
}

type Tab = 'search' | 'rank'

const STATUS_COPY = {
  completed: ['完结', 'Completed'],
  ongoing: ['连载中', 'Ongoing'],
  unknown: ['状态未知', 'Status unknown'],
} as const

const GENDER_COPY = {
  1: ['男频', 'Male'],
  2: ['女频', 'Female'],
} as const

/** 书封：拿不到图时留一个占位块，行高不会因为图片加载失败跳动。 */
function BookCover({ book, size = 'sm' }: { book: FanqieBookSummary; size?: 'sm' | 'md' }) {
  const box = size === 'md' ? 'h-[92px] w-[69px]' : 'h-[68px] w-[51px]'
  return book.coverUrl
    ? <img src={book.coverUrl} alt="" loading="lazy" className={`${box} shrink-0 rounded-md object-cover`} />
    : <span aria-hidden className={`${box} shrink-0 rounded-md bg-[var(--color-hover)]`} />
}

function BookMeta({ book }: { book: FanqieBookSummary }) {
  const text = useLocaleStore(s => s.text)
  const [statusZh, statusEn] = STATUS_COPY[book.status]
  return (
    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
      {[
        book.author || text('作者未知', 'Unknown author'),
        book.tags.join('、'),
        book.chapterCount > 0
          ? text(`${book.chapterCount} 章 · ${book.wordNumber.toLocaleString('zh-CN')} 字 · ${statusZh}`, `${book.chapterCount} ${pluralEn(book.chapterCount, 'chapter')} · ${book.wordNumber.toLocaleString('en-US')} ${pluralEn(book.wordNumber, 'word')} · ${statusEn}`)
          : text(`${book.wordNumber.toLocaleString('zh-CN')} 字`, `${book.wordNumber.toLocaleString('en-US')} ${pluralEn(book.wordNumber, 'word')}`),
        book.readCount > 0 ? text(`${book.readCount.toLocaleString('zh-CN')} 人在读`, `${book.readCount.toLocaleString('en-US')} reading`) : '',
      ].filter(Boolean).join('｜')}
    </span>
  )
}

/** 一条分项评分：标签、进度条、数值。用主题色画条，不写颜色字面量。 */
function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--color-hover)' }}>
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: 'var(--color-accent)' }} />
      </span>
      <span className="w-7 shrink-0 text-right text-[0.7rem] tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{value}</span>
    </span>
  )
}

/** 番茄书库：搜书、按分类看榜单、把几本书的结构融合成一部新作品的设定。 */
export default function FanqieLibraryDialog({ open, onClose }: FanqieLibraryDialogProps) {
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const createProject = useProjectStore(s => s.createProject)
  const publishSavedNovelConfig = useProjectStore(s => s.publishSavedNovelConfig)

  const [tab, setTab] = useState<Tab>('search')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<FanqieSearchResult | null>(null)
  const [rank, setRank] = useState<FanqieRankPage | null>(null)
  const [gender, setGender] = useState<1 | 2>(1)
  const [categoryId, setCategoryId] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<FanqieBookSummary[]>([])
  const [focus, setFocus] = useState('')
  const [bookName, setBookName] = useState('')
  const [savePath, setSavePath] = useState<ProjectDirectoryGrant | null>(null)
  const [fusing, setFusing] = useState(false)
  const [naming, setNaming] = useState(false)
  const [titleOptions, setTitleOptions] = useState<string[]>([])
  const [directing, setDirecting] = useState(false)
  const [focusOptions, setFocusOptions] = useState<string[]>([])
  const [bundleNote, setBundleNote] = useState('')

  const suggestedTitle = useMemo(
    () => (selected.length >= 2 ? buildFanqieFusionBrief(selected).suggestedTitle : ''),
    [selected],
  )

  const insight = useMemo<FanqieSelectionInsight | null>(
    () => (selected.length > 0 ? buildFanqieSelectionInsight(selected) : null),
    [selected],
  )

  /** 把选书诊断翻成两句提示：题材叠在一起会不会跑偏，节奏比平台主流快还是慢。 */
  const insightNotes = useMemo(() => {
    if (!insight) return []
    const percent = Math.round(insight.overlap * 100)
    const words = insight.wordsPerChapter.toLocaleString('zh-CN')
    const wordsEn = insight.wordsPerChapter.toLocaleString('en-US')
    const blend = insight.blend === 'scattered'
      ? text(
        `标签只重合 ${percent}%，几本差得远，融出来容易四不像。挑一本当骨架，其余只借节奏。`,
        `Tags overlap only ${percent}%; the references are far apart, so the fusion can lose its shape. Use one book as the skeleton and borrow pacing from the rest.`,
      )
      : insight.blend === 'identical'
        ? text(
          `标签重合 ${percent}%，几本几乎同类，容易和参考作品撞车。换一本不同题材进来，或把取向写具体。`,
          `Tags overlap ${percent}%; the books are nearly the same genre, so the result may collide with the references. Add a different genre or write a more specific direction.`,
        )
        : text(
          `标签重合 ${percent}%，骨架一致，还能各带一点新意。`,
          `Tags overlap ${percent}%; the skeleton is shared and each book still adds something new.`,
        )
    const pace = insight.density === 'thin'
      ? text(
        `每章 ${words} 字，比平台主流短，日更省力，单章要有更硬的钩子。`,
        `${wordsEn} ${pluralEn(insight.wordsPerChapter, 'word')} per chapter is shorter than the platform norm: easier to ship daily, so each chapter needs a harder hook.`,
      )
      : insight.density === 'thick'
        ? text(
          `每章 ${words} 字偏长，写完一章比参考作品更费时间。`,
          `${wordsEn} ${pluralEn(insight.wordsPerChapter, 'word')} per chapter is long; each chapter costs more time than the references did.`,
        )
        : text(
          `每章 ${words} 字，和参考作品的节奏一致。`,
          `${wordsEn} ${pluralEn(insight.wordsPerChapter, 'word')} per chapter matches the reference rhythm.`,
        )
    return [blend, pace]
  }, [insight, text])

  const candidates = tab === 'rank' ? rank?.candidates ?? [] : result?.candidates ?? []
  const note = tab === 'rank' ? rank?.note : result?.note
  const categories = gender === 2 ? rank?.categories.female ?? [] : rank?.categories.male ?? []

  const runSearch = useCallback(async () => {
    if (!keyword.trim()) {
      setError(text('请输入书名、关键词或番茄书籍链接', 'Enter a title, keyword, or Fanqie book link'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await ipc.invoke('fanqie:search', keyword.trim())
      if (!response.success || !response.result) {
        setResult(null)
        setError(displayedErrorMessage(locale, response.error, text('番茄书库暂时不可用', 'The Fanqie library is unavailable right now')))
        return
      }
      setResult(response.result)
      if (response.result.candidates.length === 1 && response.result.source === 'link') {
        setBookName(previous => previous || response.result!.candidates[0].bookName)
      }
    } catch (cause) {
      setError(displayedErrorMessage(locale, cause))
    } finally {
      setLoading(false)
    }
  }, [keyword, locale, text])

  const loadRank = useCallback(async (nextGender: 1 | 2, nextCategoryId: string | undefined) => {
    setLoading(true)
    setError('')
    try {
      const response = await ipc.invoke('fanqie:rank', nextCategoryId ? { gender: nextGender, categoryId: nextCategoryId } : { gender: nextGender })
      if (!response.success || !response.result) {
        setRank(null)
        setError(displayedErrorMessage(locale, response.error, text('番茄榜单暂时不可用', 'The Fanqie ranking is unavailable right now')))
        return
      }
      setRank(response.result)
      setGender(response.result.gender)
      setCategoryId(response.result.categoryId)
    } catch (cause) {
      setError(displayedErrorMessage(locale, cause))
    } finally {
      setLoading(false)
    }
  }, [locale, text])

  const switchTab = (next: Tab) => {
    setTab(next)
    if (next === 'rank' && !rank) void loadRank(gender, undefined)
  }

  const switchGender = (next: 1 | 2) => {
    if (next === gender && rank) return
    setGender(next)
    setCategoryId('')
    void loadRank(next, undefined)
  }

  const toggleBook = (book: FanqieBookSummary) => {
    const picked = selected.some(item => item.bookId === book.bookId)
    const next = picked
      ? selected.filter(item => item.bookId !== book.bookId)
      : selected.length >= FANQIE_FUSION_MAX_BOOKS ? selected : [...selected, book]
    setSelected(next)
    setTitleOptions([])
    setFocusOptions([])
    setBundleNote('')
    // 选到第二本还没起名时先放上推荐名，省得点融合时被「请先起个名字」挡住。
    if (next.length >= 2 && !bookName.trim()) setBookName(buildFanqieFusionBrief(next).suggestedTitle)
  }

  /** 一键配单：按题材骨架与节奏从当前候选里挑三本，并把为什么这么配写在下面。 */
  const pickBundle = () => {
    const suggestion = suggestFanqieBundle(candidates, 3)
    if (!suggestion) {
      setError(text('候选还不够配一单，至少要有两本', 'Not enough candidates to draft a set; at least two are needed'))
      return
    }
    setError('')
    setTitleOptions([])
    setFocusOptions([])
    setSelected(suggestion.books)
    if (!bookName.trim()) setBookName(buildFanqieFusionBrief(suggestion.books).suggestedTitle)
    const names = suggestion.books.map(book => `《${book.bookName}》`).join('')
    const shared = suggestion.sharedTags.slice(0, 2).join('、')
    const added = suggestion.addedTags.slice(0, 3).join('、')
    setBundleNote(text(
      `配了 ${suggestion.books.length} 本：${names}，综合 ${suggestion.score.total} 分。${shared ? `共同 ${shared}` : '没有共同标签，只借节奏'}${added ? `，另外带来 ${added}` : ''}。${suggestion.alternatives > 0 ? `同题材还有 ${suggestion.alternatives} 本可换。` : ''}`,
      `Drafted ${suggestion.books.length}: ${suggestion.books.map(book => `"${book.bookName}"`).join(' ')}. Overall ${suggestion.score.total}. ${shared ? `Shared ${shared}` : 'No shared tag, borrowing pace only'}${added ? `, plus ${added}` : ''}. ${suggestion.alternatives > 0 ? `${suggestion.alternatives} more in the same genre are available.` : ''}`,
    ))
  }

  const pickFolder = async () => {
    const folder = await ipc.invoke('dialog:select-folder', 'project-create')
    if (folder) setSavePath(folder)
  }

  /** 单次补全：起名与定方向共用。模型没配、或生成失败时返回空串，并给出提示。 */
  const completeOnce = useCallback(async (system: string, prompt: string, maxTokens: number) => {
    const modelId = routeModelId('generate-global-config')
    if (!modelId) {
      setError(text('请先在设置里配置 AI 模型，这一步需要模型', 'Configure an AI model in Settings first; this step needs a model'))
      return ''
    }
    const res = await ipc.invoke('llm:complete-once', { modelId, system, prompt, maxTokens, timeoutMs: 45_000 })
    if (!res.success) {
      setError(displayedErrorMessage(locale, res.error, text('这次生成没有成功，请再试一次', 'That generation did not succeed; please try again')))
      return ''
    }
    return String(res.text ?? '')
  }, [locale, text])

  /** 一键起名：按已选参考作品与融合取向，让模型出几个候选书名，点一下就填进去。 */
  const suggestTitles = async () => {
    if (naming || selected.length === 0) return
    setNaming(true)
    setError('')
    try {
      const raw = await completeOnce(
        text(
          '你是中文网文书名策划。只输出书名，一行一个，不要编号、引号和任何解释。',
          'You are a Chinese web-novel title strategist. Output only titles, one per line, no numbering, quotes, or explanations.',
        ),
        text(
          `根据参考作品融合出一部原创长篇，请起 5 个候选书名。要求：4-8 个字，网文风，有记忆点，不与参考作品重名。融合取向：${focus.trim() || '未指定'}。\n参考作品：\n${selected.map(book => `《${book.bookName}》标签：${book.tags.join('、') || '无'}`).join('\n')}`,
          `Fuse the reference works into one original long-form novel and propose 5 candidate titles. Requirements: 4-8 words, web-novel flavor, memorable, not duplicating any reference title. Fusion focus: ${focus.trim() || 'unspecified'}.\nReference works:\n${selected.map(book => `"${book.bookName}" tags: ${book.tags.join(', ') || 'none'}`).join('\n')}`,
        ),
        200,
      )
      if (!raw) return
      const options = raw
        .split('\n')
        .map(line => line.replace(/^[\s\d.、·\-—]+/u, '').replace(/[《》"「」『』]/gu, '').trim())
        .filter(Boolean)
        .slice(0, 6)
      setTitleOptions(options)
      if (options[0] && !bookName.trim()) setBookName(options[0])
    } finally {
      setNaming(false)
    }
  }

  /** 一键定方向：按已选作品的标签、规模与在读数，让模型写两条可直接用的融合取向。 */
  const suggestFocus = async () => {
    if (directing || selected.length === 0) return
    setDirecting(true)
    setError('')
    try {
      const catalog = selected.map((book, index) => {
        const perChapter = book.chapterCount > 0 ? Math.round(book.wordNumber / book.chapterCount) : 0
        return text(
          `${index + 1}.《${book.bookName}》标签：${book.tags.join('、') || '无'}｜在读 ${book.readCount.toLocaleString('zh-CN')}${perChapter > 0 ? `｜每章约 ${perChapter} 字` : ''}｜${book.status === 'completed' ? '已完结' : book.status === 'ongoing' ? '连载中' : '状态未知'}`,
          `${index + 1}. "${book.bookName}" tags: ${book.tags.join(', ') || 'none'} | ${book.readCount.toLocaleString('en-US')} reading${perChapter > 0 ? ` | about ${perChapter} ${pluralEn(perChapter, 'word')} per chapter` : ''} | ${book.status}`,
        )
      }).join('\n')
      const scale = insight ? text(`${insight.totalChapters} 章、每章约 ${insight.wordsPerChapter} 字`, `${insight.totalChapters} ${pluralEn(insight.totalChapters, 'chapter')} of about ${insight.wordsPerChapter} ${pluralEn(insight.wordsPerChapter, 'word')}`) : ''
      const raw = await completeOnce(
        text(
          '你是中文网文选题策划。只输出融合方向，一行一条，不要编号、标题和解释。',
          'You are a Chinese web-fiction development editor. Output only fusion directions, one per line, with no numbering, headings, or commentary.',
        ),
        text(
          `要为一部融合长篇定方向，规模 ${scale}。参考作品：\n${catalog}\n\n写 2 条融合方向，每条 60 到 90 字，必须包含：一句话卖点、目标读者、主角处境与他的优势、与参考作品的明显区别。两条方向要不同，一条偏稳，一条偏新。`,
          `Set the direction for a fused long-form novel of ${scale}. Reference works:\n${catalog}\n\nWrite 2 fusion directions, each 40 to 60 words, each covering: a one-line pitch, the target reader, the lead's situation and edge, and a clear difference from the references. Make the two directions different: one safer, one fresher.`,
        ),
        400,
      )
      if (!raw) return
      const options = raw
        .split('\n')
        .map(line => line.replace(/^[\s\d.、·\-—]+/u, '').replace(/^["「『]|["」』]$/gu, '').trim())
        .filter(Boolean)
        .slice(0, 3)
      setFocusOptions(options)
      if (options[0] && !focus.trim()) setFocus(options[0])
    } finally {
      setDirecting(false)
    }
  }

  const fuse = async () => {
    if (selected.length < 2) {
      setError(text('至少选两本书才能融合', 'Select at least two books to fuse'))
      return
    }
    if (!bookName.trim()) {
      setError(text('请先给新作品起个名字', 'Name the new book first'))
      return
    }
    if (!savePath) {
      setError(text('请先选择保存位置', 'Choose where to save the book'))
      return
    }
    if (!routeModelId('generate-global-config')) {
      setError(text('请先在设置里配置 AI 模型，融合结果需要模型生成设定', 'Configure an AI model in Settings first; fusing needs a model to write the setup'))
      return
    }

    setFusing(true)
    setError('')
    let brief
    try {
      brief = buildFanqieFusionBrief(selected, focus)
    } catch (cause) {
      setFusing(false)
      setError(displayedErrorMessage(locale, cause))
      return
    }

    const primaryTag = selected[0].tags[0] ?? ''
    const created = await createProject({
      name: bookName.trim(),
      parentGrantId: savePath.grantId,
      genre: primaryTag,
      targetAudience: '',
      writingLanguage: locale,
    })
    setSavePath(null)
    if (!created) {
      setFusing(false)
      setError(text('新建作品没有完成，融合已取消', 'The book was not created, so fusing stopped'))
      return
    }

    const project = useProjectStore.getState().currentProject
    const projectSession = projectSessionContextFromProject(project)
    if (!project || !projectSession) {
      setFusing(false)
      setError(text('新作品没有完成载入，融合已取消', 'The new book did not finish loading, so fusing stopped'))
      return
    }

    // 先按参考作品的中位规模写好章数与每章字数，配置生成才会照这个规模规划大纲。
    const changes: Partial<NovelConfig> = {
      totalChapters: brief.totalChapters,
      wordsPerChapter: brief.wordsPerChapter,
    }
    const written = await ipc.invokeWithProjectSession(
      projectSession,
      'project:update-config',
      project.id,
      { novelConfig: { ...project.novelConfig, ...changes } },
      project.path,
    )
    if (!written.success) {
      setFusing(false)
      setError(displayedErrorMessage(locale, written.error, text('规模没有写进作品，融合已取消', 'The scale was not saved, so fusing stopped')))
      return
    }
    publishSavedNovelConfig(changes, projectSession, 'none')

    startConfigGeneration({ idea: brief.idea, projectSession, onGenerated: () => undefined })
    setFusing(false)
    onClose()
  }

  /** 关闭时清掉上一次的错误，重新打开不会挂着旧提示；已选的书和融合取向保留。 */
  const closeDialog = useCallback(() => {
    setError('')
    onClose()
  }, [onClose])

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) closeDialog() }}>
      <DialogContent className="max-w-[700px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Library size={18} className="text-[var(--color-accent)]" />
            {text('番茄书库', 'Fanqie library')}
          </DialogTitle>
          <DialogDescription>
            {text(
              '按书名、关键词或链接找作品，也可以按男频女频的题材翻榜单。读的是公开的书籍详情页：封面、书名、作者、标签、简介、字数、连载状态与全部章节标题，章节正文不读取。选两本以上可以融合成一部新作品的设定。',
              'Find books by title, keyword, or link, or browse rankings by genre. Public book pages provide the cover, title, author, tags, synopsis, word count, serial status, and every chapter title; chapter text is never fetched. Pick two or more to fuse into a new book setup.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label={text('书库入口', 'Library entry')}>
            <Button type="button" variant={tab === 'search' ? 'default' : 'outline'} aria-pressed={tab === 'search'} onClick={() => switchTab('search')}>
              <Search size={14} />
              {text('搜书', 'Search')}
            </Button>
            <Button type="button" variant={tab === 'rank' ? 'default' : 'outline'} aria-pressed={tab === 'rank'} onClick={() => switchTab('rank')}>
              <BookMarked size={14} />
              {text('分类榜单', 'Rankings')}
            </Button>
          </div>

          {tab === 'search' && (
            <div>
              <Label htmlFor="fanqie-keyword">{text('书名、关键词或书籍链接', 'Title, keyword, or book link')}</Label>
              <div className="flex gap-2">
                <Input
                  id="fanqie-keyword"
                  value={keyword}
                  placeholder={text('例如：十日终焉，或 https://fanqienovel.com/page/…', 'For example: a title, or https://fanqienovel.com/page/…')}
                  onChange={event => setKeyword(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') void runSearch() }}
                />
                <Button type="button" variant="secondary" disabled={loading} onClick={() => void runSearch()}>
                  {text('搜索', 'Search')}
                </Button>
              </div>
            </div>
          )}

          {tab === 'rank' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-2" role="group" aria-label={text('频道', 'Channel')}>
                  {([1, 2] as const).map(value => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={gender === value ? 'default' : 'outline'}
                      aria-pressed={gender === value}
                      disabled={loading}
                      onClick={() => switchGender(value)}
                    >
                      {text(GENDER_COPY[value][0], GENDER_COPY[value][1])}
                    </Button>
                  ))}
                </div>
                <Button type="button" variant="text" size="sm" disabled={loading} onClick={() => void loadRank(gender, categoryId)}>
                  {text('刷新', 'Refresh')}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-label={text('分类', 'Categories')}>
                {categories.map(category => (
                  <Button
                    key={category.id}
                    type="button"
                    size="sm"
                    variant={category.id === categoryId ? 'default' : 'outline'}
                    aria-pressed={category.id === categoryId}
                    disabled={loading}
                    onClick={() => { setCategoryId(category.id); void loadRank(gender, category.id) }}
                  >
                    {category.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {loading && <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{text('正在读取番茄书籍页…', 'Reading Fanqie book pages…')}</p>}
          {error && <Notice tone="warn" title={text('没有读出来', 'Could not read it')}>{error}</Notice>}
          {note && !error && <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{note}</p>}

          {candidates.length >= 2 && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {text('不想一本本挑：按题材骨架和节奏自动配一单。', 'Rather not pick one by one: draft a set by genre skeleton and pace.')}
              </p>
              <Button type="button" variant="text" size="sm" onClick={pickBundle}>
                {text('帮我配一单', 'Suggest a bundle')}
              </Button>
            </div>
          )}

          {candidates.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={text('书籍结果', 'Book results')}>
              {candidates.map(book => {
                const picked = selected.some(item => item.bookId === book.bookId)
                const blocked = !picked && selected.length >= FANQIE_FUSION_MAX_BOOKS
                return (
                  <li key={book.bookId}>
                    <button
                      type="button"
                      aria-pressed={picked}
                      disabled={blocked}
                      onClick={() => toggleBook(book)}
                      className="flex h-full w-full gap-3 rounded-xl border p-2 text-left transition-colors disabled:opacity-60"
                      style={{
                        borderColor: picked ? 'var(--color-accent)' : 'var(--color-border)',
                        background: picked ? 'var(--color-hover)' : 'var(--color-panel)',
                      }}
                    >
                      <BookCover book={book} size="md" />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-start gap-1">
                          <span className="line-clamp-2 flex-1 text-sm font-medium text-[var(--color-text)]">{book.bookName}</span>
                          <span
                            className="shrink-0 rounded border px-1 text-[0.65rem] tabular-nums"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-accent)' }}
                            title={text('综合评分：热度、追读、结构、节奏', 'Overall score: heat, retention, structure, pace')}
                          >
                            {scoreFanqieBook(book).total}
                          </span>
                        </span>
                        <BookMeta book={book} />
                        {book.abstract && (
                          <span className="line-clamp-2 text-[0.7rem] leading-5" style={{ color: 'var(--color-text-muted)' }}>
                            {book.abstract.replace(/\s+/g, ' ')}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="pt-1 space-y-3">
            <div>
              <Label htmlFor="fanqie-selection">
                {text(`已选 ${selected.length} 本（最多 ${FANQIE_FUSION_MAX_BOOKS} 本）`, `Selected ${selected.length} (up to ${FANQIE_FUSION_MAX_BOOKS})`)}
              </Label>
              <div className="flex flex-wrap gap-2">
                {selected.length === 0
                  ? <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{text('在上面勾选要融合的作品。', 'Tick the books to fuse above.')}</span>
                  : selected.map(book => (
                    <Button key={book.bookId} type="button" variant="outline" size="sm" onClick={() => toggleBook(book)}>
                      {book.bookName} ×
                    </Button>
                  ))}
                {selected.length > 0 && (
                  <Button type="button" variant="text" size="sm" onClick={() => { setSelected([]); setBundleNote('') }}>{text('清空', 'Clear')}</Button>
                )}
              </div>
              {bundleNote && (
                <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{bundleNote}</p>
              )}
            </div>

            {insight && (
              <div className="rounded-lg border px-3 py-2 space-y-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
                <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                  {text(`这套组合：${insight.primaryTag || '题材待定'}`, `This combination: ${insight.primaryTag || 'genre undecided'}`)}
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    {' ｜ '}
                    {text(
                      `中位在读 ${insight.medianReads.toLocaleString('zh-CN')} 人，${insight.completedCount}/${insight.bookCount} 完结`,
                      `median ${insight.medianReads.toLocaleString('en-US')} reading, ${insight.completedCount} of ${insight.bookCount} completed`,
                    )}
                  </span>
                </p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {text(
                    `规模：${insight.totalChapters} 章 × 每章约 ${insight.wordsPerChapter.toLocaleString('zh-CN')} 字`,
                    `Scale: ${insight.totalChapters} ${pluralEn(insight.totalChapters, 'chapter')} × about ${insight.wordsPerChapter.toLocaleString('en-US')} ${pluralEn(insight.wordsPerChapter, 'word')}`,
                  )}
                </p>
                {insightNotes.map(note => (
                  <p key={note} className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{note}</p>
                ))}
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 pt-1 sm:grid-cols-2" role="group" aria-label={text('这套组合的评分', 'Score for this combination')}>
                  <ScoreBar label={text('综合', 'Overall')} value={insight.score.total} />
                  <ScoreBar label={text('题材集中', 'Focus')} value={insight.score.focus} />
                  <ScoreBar label={text('热度', 'Heat')} value={insight.score.heat} />
                  <ScoreBar label={text('追读', 'Retention')} value={insight.score.retention} />
                  <ScoreBar label={text('结构', 'Structure')} value={insight.score.structure} />
                  <ScoreBar label={text('节奏', 'Pace')} value={insight.score.pace} />
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="fanqie-focus">{text('融合取向（可留空）', 'Fusion focus (optional)')}</Label>
                <Button
                  type="button"
                  variant="text"
                  size="sm"
                  disabled={directing || selected.length === 0}
                  onClick={() => void suggestFocus()}
                >
                  {directing ? text('正在定方向…', 'Setting the direction…') : text('AI 定方向', 'AI set the direction')}
                </Button>
              </div>
              <Textarea
                id="fanqie-focus"
                value={focus}
                placeholder={text('例如：保留悬疑结构，用更快的爽感节奏，主角改成女性。', 'For example: keep the mystery structure, move faster, and make the lead a woman.')}
                onChange={event => setFocus(event.target.value)}
              />
              {focusOptions.length > 0 && (
                <div className="space-y-2 mt-2">
                  {focusOptions.map(option => (
                    <button
                      key={option}
                      type="button"
                      className="block w-full rounded-lg border px-3 py-2 text-left text-xs"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)', color: 'var(--color-text-secondary)' }}
                      onClick={() => setFocus(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="fanqie-book-name">{text('新作品名称', 'New book name')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="fanqie-book-name"
                  value={bookName}
                  placeholder={suggestedTitle || text('给新作品起个名字', 'Name the new book')}
                  onChange={event => setBookName(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={naming || selected.length === 0}
                  onClick={() => void suggestTitles()}
                >
                  {naming ? text('正在起名…', 'Naming…') : text('AI 起名', 'AI name it')}
                </Button>
              </div>
              {titleOptions.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {titleOptions.map(option => (
                    <Button key={option} type="button" variant="outline" size="sm" onClick={() => setBookName(option)}>
                      {option}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void pickFolder()}>{text('选择保存位置', 'Choose location')}</Button>
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{savePath?.displayName ?? text('还没有选择', 'Not chosen yet')}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={closeDialog}>{text('关闭', 'Close')}</Button>
          <Button
            type="button"
            variant="primary"
            disabled={fusing || selected.length < 2}
            onClick={() => void fuse()}
          >
            {fusing ? text('正在建作品…', 'Creating the book…') : text('融合并新建作品', 'Fuse and create book')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
