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
import {
  buildFanqieFusionBrief,
  FANQIE_FUSION_MAX_BOOKS,
  type FanqieBookSummary,
  type FanqieRankPage,
  type FanqieSearchResult,
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
          ? text(`${book.chapterCount} 章 · ${book.wordNumber.toLocaleString('zh-CN')} 字 · ${statusZh}`, `${book.chapterCount} chapters · ${book.wordNumber.toLocaleString('en-US')} words · ${statusEn}`)
          : text(`${book.wordNumber.toLocaleString('zh-CN')} 字`, `${book.wordNumber.toLocaleString('en-US')} words`),
        book.readCount > 0 ? text(`${book.readCount.toLocaleString('zh-CN')} 人在读`, `${book.readCount.toLocaleString('en-US')} reading`) : '',
      ].filter(Boolean).join('｜')}
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

  const suggestedTitle = useMemo(
    () => (selected.length >= 2 ? buildFanqieFusionBrief(selected).suggestedTitle : ''),
    [selected],
  )

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
        setError(response.error ?? text('番茄书库暂时不可用', 'The Fanqie library is unavailable right now'))
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
        setError(response.error ?? text('番茄榜单暂时不可用', 'The Fanqie ranking is unavailable right now'))
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
    setSelected(previous => {
      if (previous.some(item => item.bookId === book.bookId)) {
        return previous.filter(item => item.bookId !== book.bookId)
      }
      if (previous.length >= FANQIE_FUSION_MAX_BOOKS) return previous
      return [...previous, book]
    })
  }

  const pickFolder = async () => {
    const folder = await ipc.invoke('dialog:select-folder', 'project-create')
    if (folder) setSavePath(folder)
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
      setError(written.error ?? text('规模没有写进作品，融合已取消', 'The scale was not saved, so fusing stopped'))
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
                        <span className="line-clamp-2 text-sm font-medium text-[var(--color-text)]">{book.bookName}</span>
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
                  <Button type="button" variant="text" size="sm" onClick={() => setSelected([])}>{text('清空', 'Clear')}</Button>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="fanqie-focus">{text('融合取向（可留空）', 'Fusion focus (optional)')}</Label>
              <Textarea
                id="fanqie-focus"
                value={focus}
                placeholder={text('例如：保留悬疑结构，用更快的爽感节奏，主角改成女性。', 'For example: keep the mystery structure, move faster, and make the lead a woman.')}
                onChange={event => setFocus(event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="fanqie-book-name">{text('新作品名称', 'New book name')}</Label>
              <Input
                id="fanqie-book-name"
                value={bookName}
                placeholder={suggestedTitle || text('给新作品起个名字', 'Name the new book')}
                onChange={event => setBookName(event.target.value)}
              />
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
