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
  if (values.length === 0) throw new Error('融合简报需要至少一部参考作品')
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
  if (books.length === 0) throw new Error('融合简报需要至少一部参考作品')
  if (books.length > FANQIE_FUSION_MAX_BOOKS) throw new Error(`一次最多融合 ${FANQIE_FUSION_MAX_BOOKS} 部参考作品`)

  const shared = sharedTags(books)
  const distinctive = distinctiveTags(books)
  const suggestedTotalChapters = clamp(median(books.map(book => book.chapterCount).filter(count => count > 0)), 30, 300)
  const perChapterSamples = books
    .filter(book => book.chapterCount > 0 && book.wordNumber > 0)
    .map(book => book.wordNumber / book.chapterCount)
  const suggestedWordsPerChapter = perChapterSamples.length > 0
    ? clamp(Math.round(median(perChapterSamples) / 100) * 100, 1500, 6000)
    : 3000

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
