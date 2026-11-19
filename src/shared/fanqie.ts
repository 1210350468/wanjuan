/**
 * 番茄书库：公开书籍页的元数据模型，以及多书融合简报的拼装规则。
 *
 * 只使用书籍详情页公开提供的字段（书名、作者、标签、简介、字数、章节标题）。
 * 章节正文受站点字体混淆保护，不读取、不还原；融合基于结构与题材，不冒充文风样本。
 */

export type FanqieBookStatus = 'completed' | 'ongoing' | 'unknown'

export interface FanqieBookSummary {
  bookId: string
  bookName: string
  author: string
  tags: string[]
  abstract: string
  wordNumber: number
  chapterCount: number
  status: FanqieBookStatus
  readCount: number
  lastChapterTitle: string
  /** 书籍页的封面图地址；没有封面时为空。 */
  coverUrl?: string
  /** 开局、抽样与收尾的章节标题，用于看节奏，不含正文。 */
  chapterTitleSamples: string[]
}

export type FanqieSearchSource = 'keyword' | 'rank' | 'link'

export interface FanqieSearchResult {
  source: FanqieSearchSource
  candidates: FanqieBookSummary[]
  /** 关键词没有命中时的说明，例如检索服务不可用、已回退到榜单。 */
  note?: string
}

export interface FanqieRankCategory {
  id: string
  name: string
}

export interface FanqieRankCategories {
  male: FanqieRankCategory[]
  female: FanqieRankCategory[]
}

export interface FanqieRankRequest {
  /** 1 男频，2 女频。 */
  gender?: 1 | 2
  /** 分类 id；缺省表示全站热榜。 */
  categoryId?: string
}

export interface FanqieRankPage {
  categories: FanqieRankCategories
  gender: 1 | 2
  categoryId: string
  /** 该分类榜单上的作品总数，用来判断还能不能再往下翻。 */
  total: number
  candidates: FanqieBookSummary[]
  note?: string
}

/** 章节标题样本上限：足够看出开局与节奏，不至于让 IPC 载荷过大。 */
export const FANQIE_TITLE_SAMPLE_LIMIT = 180
/** 一次融合最多选几本书。 */
export const FANQIE_FUSION_MAX_BOOKS = 5

const JOURNAL_TAGS_LIMIT = 8

export interface FanqieFusionBrief {
  /** 交给设定生成工作流的创作脑洞。 */
  idea: string
  suggestedTitle: string
  totalChapters: number
  wordsPerChapter: number
}

function median(values: number[]): number {
  if (values.length === 0) throw new Error('FANQIE_SELECTION_EMPTY')
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 共同标签：所有参考作品都有的标签，按第一本书的顺序。 */
function sharedTags(books: readonly FanqieBookSummary[]): string[] {
  if (books.length === 0) return []
  const [first, ...rest] = books
  return first.tags.filter(tag => rest.every(book => book.tags.includes(tag)))
}

/** 频次最高的标签，用来在没有共同标签时给出一个题材判断。 */
function mostFrequentTag(books: readonly FanqieBookSummary[]): string {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const book of books) {
    for (const tag of book.tags) {
      const entry = counts.get(tag)
      counts.set(tag, { tag, count: (entry?.count ?? 0) + 1 })
    }
  }
  let best = ''
  let bestCount = 0
  for (const entry of counts.values()) {
    if (entry.count > bestCount) {
      best = entry.tag
      bestCount = entry.count
    }
  }
  return best
}

/** 参考作品的中位规模，限制在能写完的长篇范围内。融合简报与选书诊断共用这一份判断。 */
function planScale(books: readonly FanqieBookSummary[]): { chapters: number; wordsPerChapter: number } {
  const chapters = clamp(median(books.map(book => book.chapterCount).filter(count => count > 0)), 30, 300)
  const perChapterSamples = books
    .filter(book => book.chapterCount > 0 && book.wordNumber > 0)
    .map(book => book.wordNumber / book.chapterCount)
  const wordsPerChapter = perChapterSamples.length > 0
    ? clamp(Math.round(median(perChapterSamples) / 100) * 100, 1500, 6000)
    : 3000
  return { chapters, wordsPerChapter }
}

/** 每章字数相对平台常见的 2000 到 4000 字区间的位置。 */
export type FanqieChapterDensity = 'thin' | 'normal' | 'thick'
/** 几本书叠在一起之后的题材重合程度：分散、正常、几乎同类。 */
export type FanqieBlendRisk = 'scattered' | 'balanced' | 'identical'

/**
 * 单本参考作品的多维评分，每一项 0 到 100。
 * 只用书籍页公开字段，同样的数据每次得分相同；各项口径见下面每个函数的注释。
 */
export interface FanqieBookScore {
  /** 热度：在读人数按对数刻度铺满分值。 */
  heat: number
  /** 追读：贝叶斯收缩后的单章在读，样本少的书向平台先验靠拢。 */
  retention: number
  /** 结构完整度：完结优于连载，连载按已写章数给分。 */
  structure: number
  /** 节奏：单章字数离平台主流有多远，用高斯核换算成相似度。 */
  pace: number
  /** 加权总分。 */
  total: number
}

/** 平台先验：每章在读数，取榜单作品的中位量级。 */
const PER_CHAPTER_PRIOR = 300
/** 先验的等效章数：一本 300 章的作品才把先验权重压到一半。 */
const PRIOR_CHAPTERS = 300
/** 主流单章字数，节奏相似度的中心。 */
const MAINSTREAM_WORDS_PER_CHAPTER = 3000
/** 高斯核带宽：单章字数偏离主流 1.65 倍时降到 60 分左右。 */
const PACE_KERNEL_SIGMA = 0.5

/**
 * 加权评分（IMDb Top 250 的口径）：把「每章在读」当作评分、章数当作票数，
 * 向平台先验收缩，避免刚开几章的作品靠少数读者刷出高分。
 * 公式 (v·R + m·C) / (v + m)，v 是章数，R 是每章在读，C 是先验，m 是先验的等效章数。
 */
function shrunkPerChapterReads(book: FanqieBookSummary): number {
  if (book.chapterCount <= 0 || book.readCount <= 0) return 0
  return (book.readCount + PRIOR_CHAPTERS * PER_CHAPTER_PRIOR) / (book.chapterCount + PRIOR_CHAPTERS)
}

/** 追读分：收缩后的每章在读，1 章 32 人到 3162 人铺满 0 到 100 的对数刻度。 */
function retentionScore(book: FanqieBookSummary): number {
  const perChapter = shrunkPerChapterReads(book)
  if (perChapter <= 0) return 0
  return clamp(Math.round((Math.log10(perChapter) - 1.5) / 2 * 100), 0, 100)
}

/** 热度分：在读人数取对数，1 千到 1 千万铺满 0 到 100。 */
function heatScore(readCount: number): number {
  return clamp(Math.round((Math.log10(readCount + 1) - 3) / 4 * 100), 0, 100)
}

/** 结构分：完结给满分，连载按已写章数递增，没有章数信息时给低分。 */
function structureScore(book: FanqieBookSummary): number {
  if (book.chapterCount <= 0) return 20
  if (book.status === 'completed') return 100
  if (book.status === 'ongoing') return clamp(Math.round(book.chapterCount / 300 * 80), 20, 90)
  return 40
}

/**
 * 节奏分：把单章字数取对数后与主流值比距离，用高斯核（RBF）换算成 0 到 100 的相似度。
 * 核函数与推荐系统里按特征距离算相似度的做法一致，越接近主流越高，没有硬分段。
 */
function paceScore(book: FanqieBookSummary): number {
  if (book.chapterCount <= 0 || book.wordNumber <= 0) return 30
  const distance = Math.log((book.wordNumber / book.chapterCount) / MAINSTREAM_WORDS_PER_CHAPTER)
  return clamp(Math.round(Math.exp(-(distance * distance) / (2 * PACE_KERNEL_SIGMA * PACE_KERNEL_SIGMA)) * 100), 0, 100)
}

export function scoreFanqieBook(book: FanqieBookSummary): FanqieBookScore {
  const heat = heatScore(book.readCount)
  const retention = retentionScore(book)
  const structure = structureScore(book)
  const pace = paceScore(book)
  return {
    heat,
    retention,
    structure,
    pace,
    total: Math.round(0.3 * heat + 0.2 * retention + 0.25 * structure + 0.25 * pace),
  }
}

/** 两本书标签集合的 Jaccard 相似度：交集除以并集，0 到 1。 */
function tagSimilarity(left: FanqieBookSummary, right: FanqieBookSummary): number {
  const union = new Set([...left.tags, ...right.tags])
  if (union.size === 0) return 0
  return left.tags.filter(tag => right.tags.includes(tag)).length / union.size
}

/**
 * 整单的题材相干度：所有书两两 Jaccard 相似度的平均。
 * 两两平均是衡量一组条目「是不是同一类」的常用做法，比「共同标签 ÷ 全部标签」稳：
 * 每本各带一个细分标签时，不会把同题材的组合算成各不相干。
 */
export function tagCoherence(books: readonly FanqieBookSummary[]): number {
  if (books.length < 2) return books.length === 1 ? 1 : 0
  let total = 0
  let pairs = 0
  for (let left = 0; left < books.length; left++) {
    for (let right = left + 1; right < books.length; right++) {
      total += tagSimilarity(books[left], books[right])
      pairs++
    }
  }
  return pairs === 0 ? 0 : total / pairs
}

export interface FanqieSelectionScore {
  /** 几本的中位分数，避免一本爆款把整单分数抬起来。 */
  heat: number
  retention: number
  structure: number
  pace: number
  /** 题材集中度：两两相干度太散扣分，几本几乎同质也扣分。 */
  focus: number
  total: number
  books: FanqieBookScore[]
}

/** 这一单组合的评分：四维取中位数，再加题材集中度。 */
export function buildFanqieSelectionScore(books: readonly FanqieBookSummary[]): FanqieSelectionScore {
  if (books.length === 0) throw new Error('FANQIE_SELECTION_EMPTY')
  if (books.length > FANQIE_FUSION_MAX_BOOKS) throw new Error('FANQIE_SELECTION_TOO_MANY')

  const scores = books.map(scoreFanqieBook)
  const heat = median(scores.map(score => score.heat))
  const retention = median(scores.map(score => score.retention))
  const structure = median(scores.map(score => score.structure))
  const pace = median(scores.map(score => score.pace))
  const coherence = tagCoherence(books)
  const focus = books.length < 2
    ? 100
    : coherence < 0.15 ? 45 : coherence >= 0.6 ? 55 : 100

  return {
    heat,
    retention,
    structure,
    pace,
    focus,
    total: Math.round(0.22 * heat + 0.16 * retention + 0.2 * structure + 0.2 * pace + 0.22 * focus),
    books: scores,
  }
}

export interface FanqieSelectionInsight {
  bookCount: number
  /** 题材判断：优先用共同标签，没有共同标签时取出现次数最多的标签。 */
  primaryTag: string
  sharedTags: string[]
  /** 题材相干度：两两标签 Jaccard 相似度的平均，0 到 1。 */
  overlap: number
  totalChapters: number
  wordsPerChapter: number
  medianReads: number
  completedCount: number
  density: FanqieChapterDensity
  blend: FanqieBlendRisk
  /** 这套组合的多维评分。 */
  score: FanqieSelectionScore
}

/**
 * 选书诊断：只根据书籍页的公开字段算，不调模型。
 * 给作者回答三个问题：这算哪个题材、要写多大的规模、这几本叠在一起有没有风险；再给一套分项评分。
 */
export function buildFanqieSelectionInsight(books: readonly FanqieBookSummary[]): FanqieSelectionInsight {
  if (books.length === 0) throw new Error('FANQIE_SELECTION_EMPTY')
  if (books.length > FANQIE_FUSION_MAX_BOOKS) throw new Error('FANQIE_SELECTION_TOO_MANY')

  const shared = sharedTags(books)
  const overlap = tagCoherence(books)
  const { chapters, wordsPerChapter } = planScale(books)
  const density: FanqieChapterDensity = wordsPerChapter < 2200 ? 'thin' : wordsPerChapter > 3800 ? 'thick' : 'normal'
  const blend: FanqieBlendRisk = books.length < 2
    ? 'balanced'
    : overlap < 0.2 ? 'scattered' : overlap >= 0.8 ? 'identical' : 'balanced'

  return {
    bookCount: books.length,
    primaryTag: shared[0] ?? mostFrequentTag(books),
    sharedTags: shared,
    overlap,
    totalChapters: chapters,
    wordsPerChapter,
    medianReads: median(books.map(book => book.readCount)),
    completedCount: books.filter(book => book.status === 'completed').length,
    density,
    blend,
    score: buildFanqieSelectionScore(books),
  }
}

export interface FanqieBundleSuggestion {
  books: FanqieBookSummary[]
  /** 几本都有的标签：融合后的题材骨架。 */
  sharedTags: string[]
  /** 被选中的书各自带进来、别的书没有的标签，说明这单不是同质堆叠。 */
  addedTags: string[]
  /** 候选里同题材但没进这一单的本数，方便再换一单。 */
  alternatives: number
  /** 这一单自己的多维评分，界面直接显示。 */
  score: FanqieSelectionScore
}

/** 一本参考作品自身值不值得进融合：直接用多维评分的总分。 */
function bookValue(book: FanqieBookSummary): number {
  return scoreFanqieBook(book).total / 100
}

/**
 * 一键配单：从当前候选里挑出一组可以直接融合的参考作品。
 * 先找题材最靠中间的那本当骨架，再逐本补进「和新书有共同标签、又带着新卖点」的作品；
 * 只看书籍页字段，不调模型，同样的候选每次给出同样的结果。
 */
export function suggestFanqieBundle(
  candidates: readonly FanqieBookSummary[],
  maxBooks = 3,
): FanqieBundleSuggestion | null {
  const unique: FanqieBookSummary[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate.bookId)) continue
    seen.add(candidate.bookId)
    unique.push(candidate)
  }
  if (unique.length < 2) return null

  const limit = clamp(Math.round(maxBooks), 2, FANQIE_FUSION_MAX_BOOKS)

  // 骨架优先：和越多候选共题材的书，越适合当这一单的主参考，避免让一本爆款跑偏整单。
  const centrality = (book: FanqieBookSummary): number => {
    const others = unique.filter(other => other !== book)
    const linked = others.filter(other => other.tags.some(tag => book.tags.includes(tag))).length
    return others.length === 0 ? 0 : linked / others.length
  }
  const ranked = [...unique].sort((left, right) => {
    const leftScore = 0.45 * bookValue(left) + 0.55 * centrality(left)
    const rightScore = 0.45 * bookValue(right) + 0.55 * centrality(right)
    return rightScore - leftScore || right.readCount - left.readCount || left.bookId.localeCompare(right.bookId)
  })

  const picked: FanqieBookSummary[] = [ranked[0]]
  const union = new Set(ranked[0].tags)
  while (picked.length < limit) {
    let best: FanqieBookSummary | null = null
    let bestScore = -1
    for (const candidate of ranked) {
      if (picked.includes(candidate)) continue
      // 1 表示这根标签在已选的每一本里都有，整合度最高；0.5 表示只和其中一本沾边；0 是完全无关。
      const anchor = candidate.tags.some(tag => picked.every(book => book.tags.includes(tag)))
        ? 1
        : candidate.tags.some(tag => picked.some(book => book.tags.includes(tag))) ? 0.5 : 0
      const fresh = candidate.tags.filter(tag => !union.has(tag))
      const score = 0.4 * bookValue(candidate) + 0.4 * anchor + 0.2 * Math.min(1, fresh.length / 2)
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }
    if (!best) break
    picked.push(best)
    for (const tag of best.tags) union.add(tag)
  }

  const shared = sharedTags(picked)
  return {
    books: picked,
    sharedTags: shared,
    addedTags: [...union].filter(tag => !shared.includes(tag)),
    alternatives: unique.filter(book => !picked.includes(book) && book.tags.some(tag => union.has(tag))).length,
    score: buildFanqieSelectionScore(picked),
  }
}

/** 差异标签：各书独有的标签，用来提示哪些卖点不能混成一锅。 */
function distinctiveTags(books: readonly FanqieBookSummary[]): Array<{ bookName: string; tags: string[] }> {
  return books.map(book => ({
    bookName: book.bookName,
    tags: book.tags.filter(tag => books.filter(other => other !== book).every(other => !other.tags.includes(tag))).slice(0, 4),
  })).filter(entry => entry.tags.length > 0)
}

function describeBook(book: FanqieBookSummary, index: number): string {
  const statusText = book.status === 'completed' ? '完结' : book.status === 'ongoing' ? '连载中' : '状态未知'
  const perChapter = book.chapterCount > 0 ? Math.round(book.wordNumber / book.chapterCount) : 0
  const head = [
    `${index + 1}.《${book.bookName}》作者 ${book.author || '未知'}`,
    `标签：${book.tags.slice(0, JOURNAL_TAGS_LIMIT).join('、') || '无'}`,
    `规模：${book.wordNumber.toLocaleString('zh-CN')} 字 / ${book.chapterCount} 章 / ${statusText}${perChapter > 0 ? ` / 约 ${perChapter} 字每章` : ''}`,
    `在读：${book.readCount.toLocaleString('zh-CN')}`,
  ]
  const parts = [head.join('｜')]
  if (book.abstract.trim()) parts.push(`简介：${book.abstract.trim()}`)
  if (book.chapterTitleSamples.length > 0) {
    const samples = book.chapterTitleSamples
    const opening = samples.slice(0, 6).join(' → ')
    const middleIndex = Math.floor(samples.length / 2)
    const middle = samples.slice(Math.max(0, middleIndex - 2), middleIndex + 3).join(' → ')
    const ending = samples.slice(-4).join(' → ')
    parts.push(`开局章节：${opening}`)
    parts.push(`中段章节：${middle}`)
    parts.push(`末尾章节：${ending}`)
  }
  return parts.join('\n')
}

/**
 * 把多部参考作品拼成一份融合简报。算出来的规模取参考作品的中位数，并限制在长篇可写完的范围内。
 * focus 是作者自己的融合取向，缺省时由简报要求模型自行取舍。
 */
export function buildFanqieFusionBrief(
  books: readonly FanqieBookSummary[],
  focus = '',
): FanqieFusionBrief {
  if (books.length === 0) throw new Error('FANQIE_SELECTION_EMPTY')
  if (books.length > FANQIE_FUSION_MAX_BOOKS) throw new Error('FANQIE_SELECTION_TOO_MANY')

  const shared = sharedTags(books)
  const distinctive = distinctiveTags(books)
  const { chapters: suggestedTotalChapters, wordsPerChapter: suggestedWordsPerChapter } = planScale(books)

  const sections: string[] = []
  sections.push(`【多书融合选题】参考了 ${books.length} 部番茄小说作品，请把它们共同有效的部分融合成一部原创长篇。`)
  sections.push(`参考作品：\n${books.map(describeBook).join('\n\n')}`)
  sections.push(shared.length > 0
    ? `共同标签：${shared.join('、')}。这些是几本书都成立的市场定位，融合后的作品应当保持同类骨架。`
    : '共同标签：无。几本书的题材不同，融合时只需借它们的结构节奏，题材自行确立。')
  if (distinctive.length > 0) {
    sections.push(`各自独有的标签：\n${distinctive.map(entry => `《${entry.bookName}》：${entry.tags.join('、')}`).join('\n')}\n这些独有卖点不要全部塞进一部作品，挑一到两个与共同骨架相容的保留。`)
  }
  sections.push(focus.trim()
    ? `作者的融合取向：${focus.trim()}`
    : '作者的融合取向：未指定。按参考作品的共同骨架决定主线和主角目标。')
  sections.push([
    '融合要求：',
    `1. 规模按 ${suggestedTotalChapters} 章、每章约 ${suggestedWordsPerChapter} 字规划，这是参考作品的中位节奏。`,
    '2. 类型、目标读者、故事前提、世界观、主角人设、金手指、核心大纲、全局写作要求都要写成可以直接开写的内容。',
    '3. 参考作品只提供结构与题材依据，不得复刻其中的人物、地名、组织名或具体情节。',
    '4. 开局三章要给出与参考作品同类的抓人钩子，不要靠旁白介绍世界观。',
  ].join('\n'))

  const primary = books[0]
  const primaryTag = shared[0] ?? primary.tags[0] ?? ''

  return {
    idea: sections.join('\n\n'),
    suggestedTitle: primaryTag ? `${primaryTag}融合` : '多书融合',
    totalChapters: suggestedTotalChapters,
    wordsPerChapter: suggestedWordsPerChapter,
  }
}

/** 一次交给模型挑选的候选上限：再多也读不完，答案反而更散。 */
export const FANQIE_AI_PICK_CANDIDATE_LIMIT = 12

export interface FanqieAiPick {
  books: FanqieBookSummary[]
  /** 模型给出的融合取向。 */
  focus: string
  /** 模型说明为什么这么挑。 */
  summary: string
}

/** 从模型的回复里取出 JSON 对象：容忍 ```json 围栏与前后寒暄，只认最外层第一对花括号。 */
function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('FANQIE_AI_PICK_INVALID')
  return raw.slice(start, end + 1)
}

/**
 * 解析模型自己挑的融合组合。书号必须在当前候选里，挑不出两本就报错，
 * 不做「随便凑两本」的兜底：凑出来的组合作者没法判断。
 */
export function parseFanqieAiPick(raw: string, candidates: readonly FanqieBookSummary[]): FanqieAiPick {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonObject(raw))
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'FANQIE_AI_PICK_INVALID') throw cause
    throw new Error('FANQIE_AI_PICK_INVALID')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('FANQIE_AI_PICK_INVALID')
  const record = parsed as Record<string, unknown>

  const ids = Array.isArray(record.bookIds)
    ? record.bookIds.filter((id): id is string => typeof id === 'string')
    : []
  const books: FanqieBookSummary[] = []
  for (const id of ids) {
    const found = candidates.find(candidate => candidate.bookId === id.trim())
    if (found && !books.includes(found)) books.push(found)
  }
  if (books.length < 2) throw new Error('FANQIE_AI_PICK_TOO_FEW')

  return {
    books: books.slice(0, FANQIE_FUSION_MAX_BOOKS),
    focus: typeof record.focus === 'string' ? record.focus.trim() : '',
    summary: typeof record.summary === 'string' ? record.summary.trim() : '',
  }
}

const FANQIE_PAGE_PATH = /^\/(?:page|reader)\/(\d{8,})/
const BOOK_ID = /^\d{8,}$/

/** 从书籍页链接、阅读页链接或纯书号里取出 bookId；不是番茄地址时返回 null。 */
export function parseFanqieBookId(input: string): string | null {
  const trimmed = input.trim()
  if (BOOK_ID.test(trimmed)) return trimmed
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (!/(^|\.)fanqienovel\.com$/i.test(url.hostname)) return null
  return FANQIE_PAGE_PATH.exec(url.pathname)?.[1] ?? null
}

/** 章节标题抽样：开局、等距抽样与收尾，保持原顺序。 */
export function sampleChapterTitles(titles: readonly string[], limit = FANQIE_TITLE_SAMPLE_LIMIT): string[] {
  if (titles.length <= limit) return [...titles]
  const head = 40
  const tail = 8
  const middleCount = limit - head - tail
  const stride = Math.max(1, Math.floor((titles.length - head - tail) / middleCount))
  const picked: string[] = titles.slice(0, head)
  for (let index = head; index < titles.length - tail; index += stride) {
    if (picked.length >= head + middleCount) break
    picked.push(titles[index])
  }
  picked.push(...titles.slice(-tail))
  return picked
}
