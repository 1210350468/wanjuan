import { useMemo, useState } from 'react'
import { FileInput, FolderOpen, Library, Plus } from 'lucide-react'
import { ipc } from '../../../services/ipc-client'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { navigate } from '../../../stores/navigation/navigation-intents'
import { useProjectStore } from '../../../stores/project-store'
import { deleteCurrentProject, removeRecentProject } from '../../project-delete-action'
import { Button } from '../../ui/Button'
import { DangerConfirm } from '../../ui/DangerConfirm'
import { Menu, type MenuGroupSpec } from '../../ui/Menu'
import { Notice } from '../../ui/Notice'
import { InkDialog } from '../InkDialog'
import ModelMissingNotice from '../ModelMissingNotice'
import { LibraryUpdateCard } from '../StageUpdate'
import { useModelMissing } from '../use-model-missing'
import { useStageView } from '../use-stage-work'
import BookOverview from './BookOverview'
import ShelfBook from './ShelfBook'
import { shelfTime } from './shelf-format'
import { barsFromOverview, barsFromStages, nextStep } from './shelf-progress'
import { useShelfOverview, type ShelfBook as Book } from './use-shelf-overview'
import { pluralEn } from '../../../shared/plural-en'

type Text = (zh: string, en: string) => string

async function openProjectFolder(): Promise<void> {
  const folder = await ipc.invoke('dialog:select-folder', 'project-open')
  if (folder) await useProjectStore.getState().openProject(folder)
}

function heading(now: Date, text: Text): string {
  const hour = now.getHours()
  return hour >= 18 || hour < 5 ? text('今晚写哪一部？', 'What are we writing tonight?') : text('今天写哪一部？', 'What are we writing today?')
}

function StartActions() {
  const text = useLocaleStore(s => s.text)
  const legacyImportBusy = useProjectStore(s => s.legacyImportBusy)
  return (
    <div className="stage-starts">
      <button type="button" className="stage-start" aria-label={text('新建作品', 'New book')} onClick={() => useLayoutStore.getState().openNewProject()}>
        <span className="stage-start-icon"><Plus size={16} aria-hidden="true" /></span>
        <span className="stage-start-text"><b>{text('新建作品', 'New book')}</b><span>{text('从设定开始', 'Start from setup')}</span></span>
      </button>
      <button type="button" className="stage-start" aria-label={text('打开作品', 'Open a book')} onClick={() => void openProjectFolder()}>
        <span className="stage-start-icon"><FolderOpen size={16} aria-hidden="true" /></span>
        <span className="stage-start-text"><b>{text('打开作品', 'Open a book')}</b><span>{text('选择已有的作品文件夹', 'Choose an existing book folder')}</span></span>
      </button>
      <button type="button" className="stage-start" aria-label={text('番茄书库', 'Fanqie library')} onClick={() => useLayoutStore.getState().openFanqie()}>
        <span className="stage-start-icon"><Library size={16} aria-hidden="true" /></span>
        <span className="stage-start-text"><b>{text('番茄书库', 'Fanqie library')}</b><span>{text('搜书选题，多本融合', 'Find books and fuse their structure')}</span></span>
      </button>
      <Menu
        label={text('导入', 'Import')}
        trigger={{
          className: 'stage-start',
          content: (
            <>
              <span className="stage-start-icon"><FileInput size={16} aria-hidden="true" /></span>
              <span className="stage-start-text"><b>{text('导入', 'Import')}</b><span>{text('拆解一部小说，或旧项目', 'Break down a novel, or an old project')}</span></span>
            </>
          ),
        }}
        groups={[{ id: 'import', items: [
          { id: 'novel', label: text('小说拆解与仿写…', 'Novel breakdown & imitation…'), onSelect: () => useLayoutStore.getState().openImportNovel() },
          { id: 'legacy', label: text('导入旧项目副本…', 'Import an old project copy…'), disabled: legacyImportBusy, onSelect: () => void useProjectStore.getState().importLegacyProject() },
        ] }]}
      />
    </div>
  )
}

function LegacyImportNotice() {
  const text = useLocaleStore(s => s.text)
  const notice = useProjectStore(s => s.legacyImportNotice)
  return notice ? <Notice tone="info" title={text('导入旧项目副本', 'Import an old project copy')}>{notice}</Notice> : null
}

/** 第一次打开：书架是空的，给一条完整的入口，不只留一个孤零零的新建按钮。模型未配置不用提醒——新建不需要模型，要用 AI 的时候各入口会自己说。 */
function EmptyLibrary() {
  const text = useLocaleStore(s => s.text)
  const features = [
    {
      id: 'fanqie',
      icon: '库',
      title: text('番茄书库', 'Fanqie library'),
      desc: text('37 个题材榜单，挑几本融合成新书设定', '37 genre rankings; fuse several books into a new setup'),
      action: () => useLayoutStore.getState().openFanqie(),
    },
    {
      id: 'skills',
      icon: '技',
      title: text('Skill 超市', 'Skill marketplace'),
      desc: text('按关键字找 GitHub 仓库，批量装写作规则', 'Find GitHub repositories and install writing rules in bulk'),
      action: () => navigate({ kind: 'settings', section: 'skills' }),
    },
    {
      id: 'breakdown',
      icon: '拆',
      title: text('小说拆解与仿写', 'Novel breakdown & imitation'),
      desc: text('导入现成小说，让 AI 拆结构、提文风、反推蓝图', 'Import a novel and infer its structure, voice, and blueprints'),
      action: () => useLayoutStore.getState().openImportNovel(),
    },
    {
      id: 'guide',
      icon: '引',
      title: text('30 秒上手', '30-second tour'),
      desc: text('四步看懂模型、参考来源与写作顺序', 'Four steps on models, sources, and the writing flow'),
      action: () => useLayoutStore.getState().openGuide(),
    },
  ] as const

  const featureNumerals = ['壹', '贰', '叁', '肆'] as const

  return (
    <div className="stage-library-empty">
      <section className="stage-home-hero">
        <div className="stage-home-copy">
          <p className="stage-eyebrow">{text('书房 · 本地优先', 'Library · Local first')}</p>
          <div className="stage-title-row">
            <h1 className="stage-library-title">{text('书架还是空的', 'Your shelf is empty')}</h1>
            <span className="stage-seal" aria-hidden="true">{text('万卷', 'Wanjuan')}</span>
          </div>
          <p className="stage-library-lede">
            {text('先起一本书，再去番茄书库挑个选题。作品、设定与草稿都放在你自己的电脑上。', 'Start a book, then pick a topic from the Fanqie library. Books, setup, and drafts stay on your own computer.')}
          </p>
          <div className="stage-home-actions">
            <Button variant="primary" size="lg" onClick={() => useLayoutStore.getState().openNewProject()}>{text('新建作品', 'New book')}</Button>
            <Button variant="outline" size="lg" onClick={() => void openProjectFolder()}>{text('打开作品', 'Open a book')}</Button>
          </div>
          <p className="stage-home-note">{text('不用先配模型，先把作品建起来。', 'No model needed to create a book first.')}</p>
        </div>
        <div className="stage-home-art" aria-hidden="true">
          <span className="stage-art-book stage-art-book--back" />
          <span className="stage-art-book stage-art-book--mid" />
          <span className="stage-art-book stage-art-book--front">
            <i>{text('万卷', 'Wanjuan')}</i>
            <small>{text('从设定写到定稿', 'Setup to final')}</small>
          </span>
        </div>
      </section>

      <section className="stage-home-features" aria-label={text('快速开始', 'Quick start')}>
        <p className="stage-toc-head" aria-hidden="true">{text('目 次', 'Contents')}</p>
        {features.map((feature, index) => {
          return (
            <button key={feature.id} type="button" className="stage-feature-card" onClick={feature.action}>
              <em className="stage-feature-no" aria-hidden="true">{featureNumerals[index]}</em>
              <span className="stage-feature-icon" aria-hidden="true">{feature.icon}</span>
              <strong>{feature.title}</strong>
              <span>{feature.desc}</span>
            </button>
          )
        })}
      </section>

      <div className="stage-library-empty-notes">
        <LegacyImportNotice />
        <LibraryUpdateCard />
        {/* 旧版迁移是空书架用户才需要的路径，收成一条脚注，不再占一排按钮。 */}
        <p className="stage-library-footnote">
          {text('＊用旧版写过稿？', 'Wrote with the old app?')}{' '}
          <button type="button" onClick={() => void useProjectStore.getState().importLegacyProject()}>
            {text('导入旧项目副本', 'Import an old project copy')}
          </button>
        </p>
      </div>
    </div>
  )
}

/** 书房：开始、书架与右侧的作品概览。点封面只预览，不会打开作品。 */
export default function StageLibrary() {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const shelf = useShelfOverview()
  const view = useStageView()
  const modelMissing = useModelMissing('drafting')
  const now = useMemo(() => new Date(), [])
  const [removing, setRemoving] = useState<Book | null>(null)
  const [deleting, setDeleting] = useState<{ name: string; path: string } | null>(null)

  // 最近项目读到之前不下「书架是空的」的结论，老用户启动时不会先闪一下空书房。
  const listed = useProjectStore(s => s.recentProjectsLoaded)
  const books = shelf.recentProjects
  const waiting = books.length === 0 && !currentProject
  if (waiting && listed) return <EmptyLibrary />

  const selectedBook = shelf.selectedId ? books.find(book => book.id === shelf.selectedId) ?? null : null
  const config = currentProject?.novelConfig
  const manuscript = view.stages.find(status => status.stage === 'manuscript')
  const select = (book: Book) => {
    if (book.current) shelf.clearSelection()
    else if (book.id !== shelf.selectedId) book.onPreview()
  }

  const bookMenu = (book: Book): MenuGroupSpec[] => [
    { id: 'book', items: [
      book.current
        ? { id: 'continue', label: text('回到作品', 'Back to the book'), onSelect: () => navigate({ kind: 'stage' }) }
        : { id: 'open', label: text('打开作品', 'Open book'), onSelect: book.onOpen },
      { id: 'remove', label: text('从最近项目移除…', 'Remove from recent…'), onSelect: () => setRemoving(book) },
    ] },
    { id: 'danger', tone: 'danger', items: [book.current && currentProject
      ? { id: 'delete', label: text('删除作品…', 'Delete book…'), onSelect: () => setDeleting({ name: currentProject.name, path: currentProject.path }) }
      : { id: 'delete', label: text('删除作品（先打开这部作品）', 'Delete book (open it first)'), disabled: true, onSelect: () => undefined }] },
  ]

  const metaParts = config ? [
    config.genre,
    config.totalChapters > 0 ? text(`${config.totalChapters} 章`, `${config.totalChapters} ${pluralEn(config.totalChapters, 'chapter')}`) : '',
    config.wordsPerChapter > 0 ? text(`每章约 ${config.wordsPerChapter.toLocaleString('zh-CN')} 字`, `~${config.wordsPerChapter.toLocaleString('en-US')} ${pluralEn(config.wordsPerChapter, 'word')} each`) : '',
  ].filter(Boolean) : []

  const overviewCard = (() => {
    if (selectedBook) {
      return (
        <BookOverview
          mode="preview"
          name={selectedBook.name}
          meta={text(`上次打开 · ${shelfTime(selectedBook.updatedAt, now, text)}`, `Last opened · ${shelfTime(selectedBook.updatedAt, now, text)}`)}
          overview={shelf.overview}
          bars={shelf.overview.state === 'ready' ? barsFromOverview(shelf.overview, text) : null}
          primary={{ label: text(`打开《${selectedBook.name}》`, `Open “${selectedBook.name}”`), onClick: selectedBook.onOpen }}
          secondary={currentProject && (
            <Button variant="text" size="sm" className="stage-ov-back" onClick={shelf.clearSelection}>
              {text(`回到《${currentProject.name}》`, `Back to “${currentProject.name}”`)}
            </Button>
          )}
        />
      )
    }
    if (currentProject) {
      // 流程脊数据按这次打开载入完之前，不猜下一步，只回到作品。
      const next = view.stages.length > 0 ? nextStep(view.stages, view.chapters, text) : null
      return (
        <BookOverview
          mode="current"
          name={currentProject.name}
          meta={metaParts.join(' · ')}
          overview={shelf.overview}
          bars={next ? barsFromStages(view.stages, text) : null}
          primary={next
            ? { label: text(`继续写作 · ${next.label}`, `Continue · ${next.label}`), onClick: () => navigate(next.intent) }
            : { label: text('继续写作', 'Continue writing'), onClick: () => navigate({ kind: 'stage' }) }}
        />
      )
    }
    return (
      <section className="stage-ov stage-ov--hint">
        <p className="stage-eyebrow">{text('概览', 'Overview')}</p>
        <h2 className="stage-ov-title">{text('选一本书，看看写到哪里了', 'Pick a book to see how far it has come')}</h2>
      </section>
    )
  })()

  return (
    <div className="stage-lib">
      <section className="stage-lib-main">
        <header className="stage-hero">
          <div className="stage-hero-copy">
            <p className="stage-eyebrow">{text('书房', 'Library')}</p>
            <h1 className="stage-library-title">{heading(now, text)}</h1>
            <p className="stage-library-lede">
              {text(
                '本地优先的长篇写作台：设定、蓝图、正文、审稿都在一部作品里。',
                'A local-first desk for long fiction: setup, blueprints, prose, and review in one book.',
              )}
            </p>
          </div>
          <p className="stage-hero-note">
            {text('作品存在你自己的电脑上', 'Your books stay on your own computer')}
          </p>
        </header>
        <StartActions />
        <LegacyImportNotice />
        {!waiting && <section className="stage-shelf" aria-labelledby="stage-shelf-title">
          <div className="stage-shelf-head">
            <h2 id="stage-shelf-title" className="stage-shelf-title">{text('书架', 'Shelf')}</h2>
            <span className="stage-shelf-hint">{text('点封面查看概览，不会打开作品', 'Select a cover to preview; nothing is opened')}</span>
          </div>
          <ul className="stage-shelf-grid" aria-label={text('最近的作品', 'Recent books')}>
            {books.map(book => (
              <ShelfBook
                key={book.id}
                book={book}
                selected={selectedBook ? book.id === selectedBook.id : book.current}
                kicker={book.current ? config?.genre || text('当前作品', 'Current') : undefined}
                figure={book.current && manuscript?.stage === 'manuscript'
                  ? manuscript.total > 0 ? `${manuscript.finalized} / ${manuscript.total}` : String(manuscript.finalized)
                  : undefined}
                caption={book.current
                  ? text(`当前作品 · ${shelfTime(book.updatedAt, now, text)}`, `Open · ${shelfTime(book.updatedAt, now, text)}`)
                  : shelfTime(book.updatedAt, now, text)}
                menu={bookMenu(book)}
                onSelect={() => select(book)}
                onOpen={() => (book.current ? navigate({ kind: 'stage' }) : book.onOpen())}
              />
            ))}
          </ul>
        </section>}
      </section>
      {!waiting && (
        <aside className="stage-lib-aside" aria-label={text('作品概览', 'Book overview')}>
          {overviewCard}
          {modelMissing && <ModelMissingNotice />}
          <LibraryUpdateCard />
        </aside>
      )}

      <InkDialog
        open={removing !== null}
        onOpenChange={open => { if (!open) setRemoving(null) }}
        title={text(`从书架移除《${removing?.name ?? ''}》？`, `Remove “${removing?.name ?? ''}” from the shelf?`)}
        description={text('只移除书架上的这条记录，作品文件夹留在原处。之后用「打开作品」选它的文件夹，就会回到书架上。', 'Only the shelf entry goes away; the book folder stays where it is. Open its folder again to bring it back.')}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>{text('取消', 'Cancel')}</Button>
            <Button variant="primary" onClick={() => {
              const book = removing
              setRemoving(null)
              if (book) void removeRecentProject(book)
            }}>{text('移除记录', 'Remove entry')}</Button>
          </>
        )}
      />
      <DangerConfirm
        open={deleting !== null}
        onOpenChange={open => { if (!open) setDeleting(null) }}
        title={text(`删除《${deleting?.name ?? ''}》？`, `Delete “${deleting?.name ?? ''}”?`)}
        consequence={text('作品文件夹会连同全部章节、设定、知识库和版本历史一起删除。', 'The book folder is deleted along with every chapter, setting, knowledge entry and version.')}
        recoverability={text('删除后无法恢复。只想让它从书架上消失，请用「从最近项目移除」，文件会留在原处。', 'This cannot be undone. To only hide it from the shelf, use “Remove from recent”; the files stay.')}
        typeToConfirm={{ expected: deleting?.name ?? '', label: text('输入作品名确认', 'Type the book title to confirm') }}
        cancelLabel={text('取消', 'Cancel')}
        confirmLabel={text('删除作品', 'Delete book')}
        onConfirm={() => { if (deleting) void deleteCurrentProject(deleting) }}
      />
    </div>
  )
}
