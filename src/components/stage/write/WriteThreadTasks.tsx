import { ChevronRight } from 'lucide-react'
import type { ChapterThreadPanelRow } from '../../../shared/narrative-thread'
import { pluralEn } from '../../../shared/plural-en'
import { useLocaleStore } from '../../../stores/locale-store'
import { Button } from '../../ui/Button'
import type { useChapterThreadTasks } from './use-chapter-thread-tasks'

interface WriteThreadTasksProps {
  chapterNumber: number
  threads: ReturnType<typeof useChapterThreadTasks>
}

export default function WriteThreadTasks({ chapterNumber, threads }: WriteThreadTasksProps) {
  const text = useLocaleStore(s => s.text)
  const { panel, savingPlanId, failure, defer, assign, undo } = threads
  if (panel.rows.length === 0 && panel.canAdvance.length === 0) return null
  const saving = savingPlanId !== null

  const statusOf = (row: ChapterThreadPanelRow) => {
    if (row.state === 'deferred') return text(`已延到第 ${row.deferredTo} 章`, `Moved to Ch. ${row.deferredTo}`)
    const schedule = row.schedule.kind === 'overdue' ? text(`逾期 ${row.schedule.chaptersOverdue} 章`, `${row.schedule.chaptersOverdue} overdue`)
      : row.schedule.kind === 'due' ? text('本章到期', 'Due now') : text('本章推进', 'This chapter')
    return row.state === 'left-out' ? `${schedule} · ${text('本次不进任务', 'not in this run')}` : schedule
  }

  const action = (title: string, zh: string, en: string, onClick: () => void) => (
    <Button variant="text" size="sm" disabled={saving} aria-label={text(`${zh}：${title}`, `${en}: ${title}`)} onClick={onClick}>{text(zh, en)}</Button>
  )

  const actionsOf = (row: ChapterThreadPanelRow) => {
    const { id, title } = row.thread
    if (row.state === 'deferred') return action(title, '撤销', 'Undo', () => undo(id, row.deferredTo))
    if (row.schedule.kind === 'assigned') return action(title, '撤销', 'Undo', () => undo(id, chapterNumber))
    return (
      <>
        {action(title, '延后一章', 'Move 1 on', () => defer(id, 1))}
        {action(title, '延后三章', 'Move 3 on', () => defer(id, 3))}
      </>
    )
  }

  return (
    <section className="stage-write-threads" aria-label={text('本章线索', 'Threads for this chapter')}>
      {panel.rows.length > 0 && (
        <ul className="stage-write-thread-list">
          {panel.rows.map(row => (
            <li key={row.thread.id} className="stage-write-thread" data-state={row.state} data-saving={savingPlanId === row.thread.id || undefined}>
              <span className="stage-write-thread-name">
                <b>{row.thread.title}</b>
                <small data-overdue={(row.state !== 'deferred' && row.schedule.kind === 'overdue') || undefined}>{statusOf(row)}</small>
              </span>
              <span className="stage-write-thread-actions">{actionsOf(row)}</span>
            </li>
          ))}
        </ul>
      )}
      {panel.leftOut > 0 && <p className="stage-write-thread-note">{text(`另有 ${panel.leftOut} 条本次不进任务`, `${panel.leftOut} more ${pluralEn(panel.leftOut, 'stays', 'stay')} out of this run`)}</p>}
      {failure && <p className="stage-write-error" role="alert">{failure}</p>}
      {panel.canAdvance.length > 0 && (
        <details className="stage-write-more">
          <summary>
            <ChevronRight size={14} aria-hidden />
            {text('也可以本章推进', 'Advance one here')}
          </summary>
          <ul className="stage-write-thread-list">
            {panel.canAdvance.map(thread => (
              <li key={thread.id} className="stage-write-thread">
                <span className="stage-write-thread-name"><b>{thread.title}</b></span>
                <span className="stage-write-thread-actions">
                  {action(thread.title, '本章推进', 'Advance here', () => assign(thread.id))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
