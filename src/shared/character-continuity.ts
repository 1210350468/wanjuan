import { CHARACTER_STATE_TEXT_FIELDS, type CharacterStateTextField } from './character-roster'
import type { FinalizedCharacterEvidence, FinalizedSourceIdentity } from './finalized-continuity'

/** 节点的来历，与 character_continuity_events.provenance_json 的 kind 一一对应。 */
export type ContinuityProvenance =
  | { kind: 'author'; operationId: string }
  | { kind: 'derived'; source: FinalizedSourceIdentity }
  | { kind: 'adopted'; operationId: string; source?: FinalizedSourceIdentity }
  /** authorChapter：升级前这个状态字段就是作者填的，值是当时记下的章号。 */
  | { kind: 'legacy'; authorChapter?: number }

interface ContinuityNodeBase {
  eventId: string
  subjectId: string
  subjectName: string
  /** 空串表示已清除。 */
  value: string
  effectiveChapter: number
  provenance: ContinuityProvenance
  draftId: number | null
  /** 同一系列内的写入次序。基线节点没有记录，按 0 算。 */
  seq: number
  quote: FinalizedCharacterEvidence | null
}
export interface CharacterStateNode extends ContinuityNodeBase { aspect: CharacterStateTextField }
export interface CharacterRelationNode extends ContinuityNodeBase {
  aspect: 'relation'
  targetId: string
  targetName: string
  relationshipId: string
  authorDeclined?: true
  /** 只有定稿关系带：抽取这一章时，这条说法和作者当时的设定一样。作者之后怎么改设定都不改它。 */
  matchedAuthor?: true
}
export type ContinuityNode = CharacterStateNode | CharacterRelationNode

/** 同一对角色（不分方向）的有效关系。conflict 为真表示说法互相冲突，交给读者判断，不替作者选。 */
export interface CharacterRelationPair {
  lines: CharacterRelationNode[]
  conflict: boolean
}
export interface LatestContinuityNodes {
  states: CharacterStateNode[]
  relations: CharacterRelationPair[]
}

const authorDecided = (provenance: ContinuityProvenance) => provenance.kind === 'author' || provenance.kind === 'adopted'

/** 作者定的值「自第 N 章起」生效；派生值和基线是第 N 章写完后的状态，重写第 N 章时还不存在。升级前作者填的状态按当时记下的章，不按升级快照章。 */
export function firstVisibleChapter(node: ContinuityNode): number {
  if (node.provenance.kind === 'legacy' && node.provenance.authorChapter !== undefined) return node.provenance.authorChapter
  return authorDecided(node.provenance) ? node.effectiveChapter : node.effectiveChapter + 1
}

function newer(candidate: ContinuityNode, current: ContinuityNode): boolean {
  if (candidate.effectiveChapter !== current.effectiveChapter) return candidate.effectiveChapter > current.effectiveChapter
  const [left, right] = [authorDecided(candidate.provenance), authorDecided(current.provenance)]
  return left !== right ? left : candidate.seq > current.seq
}

/** 状态每角色每字段一个系列；关系每一行一个系列，同一对角色的多行互不覆盖。 */
const seriesKey = (node: ContinuityNode) =>
  node.aspect === 'relation' ? `relation:${node.relationshipId}` : `state:${JSON.stringify([node.subjectId, node.aspect])}`

const hasConflict = (lines: readonly CharacterRelationNode[]) => lines.some((left, index) => lines.slice(index + 1).some(right => left.value !== right.value
  && (left.subjectId === right.subjectId || left.provenance.kind === 'derived' || right.provenance.kind === 'derived')))

const isDerivedRelation = (node: ContinuityNode): node is CharacterRelationNode => node.aspect === 'relation' && node.provenance.kind === 'derived'
const pairKey = (node: CharacterRelationNode) => JSON.stringify([node.subjectId, node.targetId].sort())
const withoutAuthorRepeats = (lines: readonly CharacterRelationNode[]) =>
  lines.filter(line => line.provenance.kind !== 'derived' || !lines.some(other => other.provenance.kind !== 'derived' && other.value === line.value))

const sameStatement = (left: CharacterRelationNode, right: CharacterRelationNode) => left.value === right.value && left.subjectId === right.subjectId

/**
 * 定稿对一对人物的说法里，值、方向、matchedAuthor 都相同的连续几章是一段，head 是最早那一章。
 * 作者拒绝过其中一章的说法，整段都算拒绝。
 */
export interface DerivedRelationRun {
  head: CharacterRelationNode
  observations: CharacterRelationNode[]
  declined: boolean
}

/**
 * 正文当时是照着作者设定写的，作者之后给这对人物换了从更晚的章起生效的设定：这段说法不再算数，也不和新设定并存。
 * 作者只删掉设定、没写新的时，定稿记录照旧生效。
 */
const authorMovedOn = (head: CharacterRelationNode, settingsInForce: readonly ContinuityNode[]) => !!head.matchedAuthor
  && settingsInForce.some(node => node.aspect === 'relation' && node.value !== '' && authorDecided(node.provenance) && pairKey(node) === pairKey(head)
    && node.effectiveChapter > head.effectiveChapter)

/** 按 relationshipId 分组，段按章升序。同一章重跑过几次时只认最后写入的说法。 */
export function derivedRelationRuns(nodes: readonly ContinuityNode[]): Map<string, DerivedRelationRun[]> {
  const chapters = new Map<string, Map<number, CharacterRelationNode>>()
  for (const node of nodes) {
    if (!isDerivedRelation(node)) continue
    const series = chapters.get(node.relationshipId) ?? new Map<number, CharacterRelationNode>()
    const current = series.get(node.effectiveChapter)
    if (!current || node.seq > current.seq) series.set(node.effectiveChapter, node)
    chapters.set(node.relationshipId, series)
  }
  return new Map([...chapters].map(([key, series]) => {
    const runs: DerivedRelationRun[] = []
    for (const node of [...series.values()].sort((left, right) => left.effectiveChapter - right.effectiveChapter)) {
      const run = runs.at(-1)
      if (run && sameStatement(run.head, node) && run.head.matchedAuthor === node.matchedAuthor) {
        run.observations.push(node)
        run.declined ||= !!node.authorDeclined
      } else runs.push({ head: node, observations: [node], declined: !!node.authorDeclined })
    }
    return [key, runs]
  }))
}

/**
 * 写第 chapter 章时已经生效的最新节点。传 Infinity 得到当前值。ids 只筛结果里的主语，判断冲突时两个方向的节点都算。
 * 定稿关系返回所在那一段的段首，不是最新一章的节点。
 * nodes 应来自只含有效节点的读取（派生节点的稿仍是定稿，见 ADR-0024、ADR-0025）。
 */
export function latestNodesBefore(nodes: readonly ContinuityNode[], chapter: number, ids?: readonly string[]): LatestContinuityNodes {
  const wanted = ids && new Set(ids)
  const latest = new Map<string, ContinuityNode>()
  for (const node of nodes) {
    if (isDerivedRelation(node) || firstVisibleChapter(node) > chapter) continue
    const key = seriesKey(node), current = latest.get(key)
    if (!current || newer(node, current)) latest.set(key, node)
  }
  const settings = [...latest.values()], inForce = [...settings]
  for (const runs of derivedRelationRuns(nodes).values()) {
    const run = runs.filter(candidate => firstVisibleChapter(candidate.head) <= chapter).at(-1)
    if (run && !run.declined && !authorMovedOn(run.head, settings)) inForce.push(run.head)
  }
  const states: CharacterStateNode[] = []
  const pairs = new Map<string, CharacterRelationNode[]>()
  for (const node of inForce) {
    if (node.value === '') continue
    if (node.aspect !== 'relation') { if (!wanted || wanted.has(node.subjectId)) states.push(node); continue }
    pairs.set(pairKey(node), [...pairs.get(pairKey(node)) ?? [], node])
  }
  const relations = [...pairs.values()].flatMap(all => {
    const lines = withoutAuthorRepeats(wanted ? all.filter(line => wanted.has(line.subjectId)) : all)
    return lines.length ? [{ lines, conflict: hasConflict(withoutAuthorRepeats(all)) }] : []
  })
  return { states, relations }
}

/** last 是下一章和蓝图最后一章里较大的那个。 */
export interface StateChapterRange { next: number; last: number }

export interface CharacterContinuityTimeline {
  nodes: ContinuityNode[]
  chapterRange: StateChapterRange
}

/** 章号不合法时退回下一章。上限挡住手误：节点不早于同系列已有的章，写太大的章号后这个字段之后的改动都会被推到那一章。 */
export function resolveStateEffectiveChapter(requested: unknown, range: StateChapterRange): number {
  const legal = typeof requested === 'number' && Number.isSafeInteger(requested) && requested >= 1 && requested <= range.last
  return legal ? requested : range.next
}

export type CharacterTimelineSource = 'author' | 'finalized' | 'legacy'

const TIMELINE_SOURCE: Readonly<Record<ContinuityProvenance['kind'], CharacterTimelineSource>> = Object.freeze({
  author: 'author', adopted: 'author', derived: 'finalized', legacy: 'legacy',
})

export interface CharacterTimelineChange {
  node: ContinuityNode
  source: CharacterTimelineSource
  removed: boolean
  /** removed 时是被去掉的旧值，其余时候是节点的值。 */
  value: string
  /** 作者采用定稿发现的关系时被换掉的旧值，这时 node 带着定稿的原文。 */
  replaced?: string[]
}
export interface CharacterTimelineChapter { chapter: number; changes: CharacterTimelineChange[] }

const aspectRank = (node: ContinuityNode) => node.aspect === 'relation' ? CHARACTER_STATE_TEXT_FIELDS.length : CHARACTER_STATE_TEXT_FIELDS.indexOf(node.aspect)
const targetOf = (node: ContinuityNode) => node.aspect === 'relation' ? node.targetName : ''

/** 采用在事件表里是解除旧行、派生值、作者新值三个节点，作者看到的是一件事。靠同一次操作认定，手工改的不合并。 */
function foldAdoptedRelations(changes: readonly CharacterTimelineChange[]): CharacterTimelineChange[] {
  const absorbed = new Set<CharacterTimelineChange>()
  const folded = changes.map(change => {
    const { node } = change
    if (node.aspect !== 'relation' || node.provenance.kind !== 'author' || change.removed) return change
    const { operationId } = node.provenance
    const samePair = (other: CharacterTimelineChange) => other.node.aspect === 'relation' && other.node.subjectId === node.subjectId && other.node.targetId === node.targetId
    const found = changes.find(other => samePair(other) && other.source === 'finalized' && other.value === change.value)
    const replaced = changes.filter(other => samePair(other) && other.removed && other.node.provenance.kind === 'author' && other.node.provenance.operationId === operationId)
    if (!found || !replaced.length) return change
    for (const other of [found, ...replaced]) absorbed.add(other)
    return { ...change, node: { ...node, quote: found.node.quote }, replaced: replaced.map(other => other.value) }
  })
  return folded.filter(change => !absorbed.has(change))
}

/**
 * 时间线只列变化：一段定稿关系只留段首。值和方向都和上一段相同、或第一段的值和这一章之前就生效的设定相同时是重述，也不留。
 * nodes 要带上这对人物两个方向的节点，只有一边时会把隔着对方说法的两段并成一段。
 */
export function withoutRelationRestatements(nodes: readonly ContinuityNode[]): ContinuityNode[] {
  const settings = nodes.filter(node => !isDerivedRelation(node))
  const changes = new Set<ContinuityNode>()
  for (const runs of derivedRelationRuns(nodes).values()) runs.forEach(({ head }, index) => {
    const previous = runs[index - 1]?.head
    const restated = previous ? sameStatement(previous, head)
      : latestNodesBefore(settings.filter(node => node.effectiveChapter < head.effectiveChapter), head.effectiveChapter).relations
        .some(pair => pair.lines.some(line => pairKey(line) === pairKey(head) && line.value === head.value))
    if (!restated) changes.add(head)
  })
  return nodes.filter(node => !isDerivedRelation(node) || changes.has(node))
}

/** 同章同字段的取舍规则与 latestNodesBefore 相同。 */
export function characterTimeline(nodes: readonly ContinuityNode[]): CharacterTimelineChapter[] {
  const series = new Map<string, ContinuityNode[]>()
  for (const node of nodes) {
    const key = seriesKey(node), line = series.get(key)
    if (line) line.push(node)
    else series.set(key, [node])
  }
  const chapters = new Map<number, CharacterTimelineChange[]>()
  for (const line of series.values()) {
    line.sort((left, right) => newer(left, right) ? 1 : newer(right, left) ? -1 : 0)
    let previous = ''
    line.forEach((node, index) => {
      const removed = node.value === ''
      if (line[index + 1]?.effectiveChapter !== node.effectiveChapter) {
        const changes = chapters.get(node.effectiveChapter) ?? []
        changes.push({ node, source: TIMELINE_SOURCE[node.provenance.kind], removed, value: removed ? previous : node.value })
        chapters.set(node.effectiveChapter, changes)
      }
      if (!removed) previous = node.value
    })
  }
  return [...chapters].sort(([left], [right]) => right - left).map(([chapter, changes]) => ({
    chapter,
    changes: foldAdoptedRelations(changes).sort((left, right) => aspectRank(left.node) - aspectRank(right.node)
      || targetOf(left.node).localeCompare(targetOf(right.node)) || Number(right.removed) - Number(left.removed)),
  }))
}
