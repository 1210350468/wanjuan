import {
  parseFanqieBookId,
  sampleChapterTitles,
  type FanqieBookStatus,
  type FanqieBookSummary,
  type FanqieRankCategories,
  type FanqieRankCategory,
  type FanqieRankPage,
  type FanqieRankRequest,
  type FanqieSearchResult,
} from '../../src/shared/fanqie'
import { localize, resolveLocale } from '../../src/i18n/core'
import { mainText } from '../i18n'

/**
 * 番茄书库读取：只抓公开的书籍详情页、榜单页与榜单分类接口。
 *
 * 书籍详情页是干净数据源：书名、作者、标签、简介、字数、封面与全部章节标题都写在服务端渲染的
 * `__INITIAL_STATE__` 里。榜单列表页的字会被站点做防抓取替换，因此列表只用来取书号，
 * 书名、封面与简介一律回到详情页读取。章节正文有字体混淆保护，不读取、不还原。
 * 关键词检索没有公开接口，走 Bing 的站内检索定位书号，拿不到时退回榜单。
 */

export type FanqieLibraryErrorCode = 'NETWORK' | 'PARSE' | 'NOT_FOUND' | 'LIMIT'

export class FanqieLibraryError extends Error {
  constructor(readonly code: FanqieLibraryErrorCode, message: string) {
    super(message)
    this.name = 'FanqieLibraryError'
  }
}

/** 这里的报错会原样回到渲染层；语言按「设置里选过的，否则系统语言」，设置目录没就绪时退回系统语言。 */
function text(zhCNText: string, enUSText: string): string {
  const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale
  try {
    return mainText(systemLocale, zhCNText, enUSText)
  } catch {
    return localize(resolveLocale(systemLocale), zhCNText, enUSText)
  }
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
} as const

const BOOK_PAGE_MAX_BYTES = 8 * 1024 * 1024
const SEARCH_PAGE_MAX_BYTES = 4 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 30 * 60 * 1000
const SEARCH_CANDIDATE_LIMIT = 8
/** 单个分类最多列出的作品数：几套榜单合并去重后的上限。 */
const RANK_CANDIDATE_LIMIT = 18
const DETAIL_CONCURRENCY = 4

interface CacheEntry {
  at: number
  summary: FanqieBookSummary
}

const bookCache = new Map<string, CacheEntry>()
let cachedCategories: { at: number; categories: FanqieRankCategories } | undefined
const rankIdCache = new Map<string, { at: number; ids: string[]; total: number }>()

async function fetchText(url: string, options: { referer?: string; maxBytes: number; accept?: string }): Promise<string> {
  const response = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      ...(options.accept ? { Accept: options.accept } : {}),
      ...(options.referer ? { Referer: options.referer } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new FanqieLibraryError('NETWORK', text(`番茄书库返回 ${response.status}`, `The Fanqie library returned ${response.status}`))
  }
  const declared = Number(response.headers.get('content-length') ?? 0)
  const tooLarge = () => new FanqieLibraryError('LIMIT', text('番茄书库返回的页面过大', 'The page returned by the Fanqie library is too large'))
  if (declared > options.maxBytes) throw tooLarge()
  const body = await response.text()
  if (Buffer.byteLength(body, 'utf8') > options.maxBytes) throw tooLarge()
  return body
}

/** 从 HTML 里截出 `__INITIAL_STATE__` 的 JSON 对象，按字符串边界扫描括号，避免字符串里的花括号打断配对。 */
function extractInitialState(html: string, label: string): Record<string, unknown> {
  const marker = '__INITIAL_STATE__='
  const markerAt = html.indexOf(marker)
  if (markerAt < 0) {
    throw new FanqieLibraryError('PARSE', text(`番茄${label}缺少初始数据`, `The Fanqie ${label} has no initial data`))
  }
  const source = html.slice(markerAt + marker.length)
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) { end = index + 1; break }
    }
  }
  if (end < 0) {
    throw new FanqieLibraryError('PARSE', text(`番茄${label}的初始数据不完整`, `The Fanqie ${label} initial data is incomplete`))
  }
  return parseStateObject(source.slice(0, end), label)
}

/** 榜单页会把没有值的字段写成裸 `undefined`，不是合法 JSON；一次替换后重试。 */
function parseStateObject(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    try {
      parsed = JSON.parse(raw.replace(/:undefined(?=[,}\]])/g, ':null'))
    } catch {
      throw new FanqieLibraryError('PARSE', text(`番茄${label}的初始数据无法解析`, `The Fanqie ${label} initial data could not be parsed`))
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new FanqieLibraryError('PARSE', text(`番茄${label}的初始数据格式不对`, `The Fanqie ${label} initial data has the wrong shape`))
  }
  return parsed as Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(asString(value))
  return Number.isFinite(parsed) ? parsed : 0
}

/** creationStatus：0 完结，1 连载中，其余按未知处理。 */
function bookStatus(value: unknown): FanqieBookStatus {
  const raw = typeof value === 'number' ? String(value) : asString(value)
  if (raw === '0') return 'completed'
  if (raw === '1') return 'ongoing'
  return 'unknown'
}

interface BookPageState {
  bookName: string
  author: string
  abstract: string
  wordNumber: number
  readCount: number
  creationStatus: unknown
  tags: string[]
  chapterTitles: string[]
  lastChapterTitle: string
  coverUrl: string
}

/** 标签来自 categoryV2：书籍页把它序列化成一段 JSON 字符串；老页面则是数组。 */
function readCategoryTags(value: unknown): string[] {
  let entries: unknown = value
  if (typeof entries === 'string') {
    if (!entries.trim()) return []
    try {
      entries = JSON.parse(entries)
    } catch {
      throw new FanqieLibraryError('PARSE', text('番茄书籍页的标签无法解析', 'The tags on the Fanqie book page could not be parsed'))
    }
  }
  if (!Array.isArray(entries)) return []
  const tags: string[] = []
  for (const entry of entries) {
    const name = asString(asRecord(entry)?.Name).trim()
    if (name && !tags.includes(name)) tags.push(name)
  }
  return tags
}

function readChapterTitles(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const titles: string[] = []
  for (const volume of value) {
    if (!Array.isArray(volume)) continue
    for (const chapter of volume) {
      const title = asString(asRecord(chapter)?.title).trim()
      if (title) titles.push(title)
    }
  }
  return titles
}

function readBookPageState(state: Record<string, unknown>): BookPageState {
  const page = asRecord(state.page)
  if (!page) {
    throw new FanqieLibraryError('PARSE', text('番茄书籍页缺少作品数据', 'The Fanqie book page has no book data'))
  }
  const bookName = asString(page.bookName).trim()
  if (!bookName) throw new FanqieLibraryError('NOT_FOUND', text('番茄没有返回这本书', 'Fanqie did not return this book'))
  const chapterTitles = readChapterTitles(page.chapterListWithVolume)
  return {
    bookName,
    author: asString(page.author).trim(),
    abstract: asString(page.abstract).trim(),
    wordNumber: asNumber(page.wordNumber),
    readCount: asNumber(page.readCount),
    creationStatus: page.creationStatus,
    tags: readCategoryTags(page.categoryV2 || page.category),
    chapterTitles,
    lastChapterTitle: asString(page.lastChapterTitle).trim(),
    coverUrl: asString(page.thumbUri).trim(),
  }
}

function toSummary(bookId: string, state: BookPageState): FanqieBookSummary {
  return {
    bookId,
    bookName: state.bookName,
    author: state.author,
    tags: state.tags,
    abstract: state.abstract,
    wordNumber: state.wordNumber,
    chapterCount: state.chapterTitles.length,
    status: bookStatus(state.creationStatus),
    readCount: state.readCount,
    lastChapterTitle: state.lastChapterTitle,
    coverUrl: state.coverUrl || undefined,
    chapterTitleSamples: sampleChapterTitles(state.chapterTitles),
  }
}

/** 读取单本书的公开元数据。 */
export async function loadFanqieBook(bookId: string): Promise<FanqieBookSummary> {
  if (!/^\d{8,}$/.test(bookId)) throw new FanqieLibraryError('NOT_FOUND', text('书号无效', 'The book ID is invalid'))
  const cached = bookCache.get(bookId)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.summary
  const html = await fetchText(`https://fanqienovel.com/page/${bookId}`, {
    referer: 'https://fanqienovel.com/',
    maxBytes: BOOK_PAGE_MAX_BYTES,
  })
  const summary = toSummary(bookId, readBookPageState(extractInitialState(html, '书籍页')))
  bookCache.set(bookId, { at: Date.now(), summary })
  return summary
}

/** 按固定并发读取多本书；单本失败不拖垮整批，返回成功的部分与首个失败原因。 */
async function loadBooks(bookIds: readonly string[]): Promise<{ books: FanqieBookSummary[]; failures: number; firstError?: string }> {
  const unique = [...new Set(bookIds)]
  const books: FanqieBookSummary[] = []
  let failures = 0
  let firstError: string | undefined
  let cursor = 0
  const worker = async () => {
    while (cursor < unique.length) {
      const bookId = unique[cursor++]
      try {
        books.push(await loadFanqieBook(bookId))
      } catch (error) {
        failures++
        firstError ??= error instanceof Error ? error.message : String(error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, unique.length) }, worker))
  const order = new Map(unique.map((id, index) => [id, index]))
  books.sort((left, right) => (order.get(left.bookId) ?? 0) - (order.get(right.bookId) ?? 0))
  return { books, failures, firstError }
}

// ===== 榜单分类 =====

function readCategories(state: Record<string, unknown>): FanqieRankCategories {
  const list = asRecord(asRecord(state.rank)?.rankCategoryTypeList)
  const read = (value: unknown): FanqieRankCategory[] => {
    if (!Array.isArray(value)) return []
    const categories: FanqieRankCategory[] = []
    for (const entry of value) {
      const record = asRecord(entry)
      const id = asString(record?.id).trim()
      const name = asString(record?.name).trim()
      if (id && name && !categories.some(category => category.id === id)) categories.push({ id, name })
    }
    return categories
  }
  const male = read(list?.male)
  const female = read(list?.female)
  if (male.length === 0 && female.length === 0) {
    throw new FanqieLibraryError('PARSE', text('番茄榜单没有返回分类', 'The Fanqie ranking returned no categories'))
  }
  return { male, female }
}

/** 榜单分类：男频与女频各有二十个左右的题材。 */
export async function loadFanqieRankCategories(): Promise<FanqieRankCategories> {
  if (cachedCategories && Date.now() - cachedCategories.at < CACHE_TTL_MS) return cachedCategories.categories
  const html = await fetchText('https://fanqienovel.com/rank', { maxBytes: SEARCH_PAGE_MAX_BYTES })
  const categories = readCategories(extractInitialState(html, '榜单页'))
  cachedCategories = { at: Date.now(), categories }
  return categories
}

/**
 * 一个分类的榜单书号：番茄的同一个题材分几套榜单（热榜、完本等），彼此条数不同。
 * 每套各取一页，按条数从多到少合并去重，最多 18 本，界面就把这个分类的榜单书看全一些。
 */
async function rankIdsForCategory(gender: 1 | 2, categoryId: string): Promise<{ ids: string[]; total: number }> {
  const cacheKey = `${gender}:${categoryId}`
  const cached = rankIdCache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { ids: cached.ids, total: cached.total }

  const molds = categoryId ? ['0', '1', '2'] : ['']
  const pages: Array<{ ids: string[]; total: number }> = []
  for (const mold of molds) {
    const path = mold === '' ? '/rank' : `/rank/${mold}_${gender}_${categoryId}`
    try {
      const html = await fetchText(`https://fanqienovel.com${path}`, { maxBytes: SEARCH_PAGE_MAX_BYTES })
      const rank = asRecord(extractInitialState(html, '榜单页').rank)
      const list = Array.isArray(rank?.book_list) ? rank.book_list : []
      const ids: string[] = []
      for (const entry of list) {
        const bookId = asString(asRecord(entry)?.bookId).trim()
        if (/^\d{8,}$/.test(bookId) && !ids.includes(bookId)) ids.push(bookId)
      }
      if (ids.length > 0) pages.push({ ids, total: asNumber(rank?.total_num) || ids.length })
    } catch {
      // 某个榜单类型没有这一分类时页面为空，换下一个类型。
    }
  }
  pages.sort((left, right) => right.total - left.total)
  const ids: string[] = []
  for (const page of pages) {
    for (const id of page.ids) {
      if (ids.length >= RANK_CANDIDATE_LIMIT) break
      if (!ids.includes(id)) ids.push(id)
    }
  }
  const total = pages[0]?.total ?? 0
  rankIdCache.set(cacheKey, { at: Date.now(), ids, total })
  return { ids, total }
}

/** 分类榜单：按男频/女频与题材取该分类的榜单作品，逐本回详情页读干净的元数据与封面。 */
export async function loadFanqieRank(request: FanqieRankRequest = {}): Promise<FanqieRankPage> {
  const gender: 1 | 2 = request.gender === 2 ? 2 : 1
  const categories = await loadFanqieRankCategories()
  const available = gender === 2 ? categories.female : categories.male
  const requested = request.categoryId?.trim() ?? ''
  const categoryId = requested && available.some(category => category.id === requested)
    ? requested
    : request.categoryId === '' ? '' : available[0]?.id ?? ''

  const { ids, total } = await rankIdsForCategory(gender, categoryId)
  if (ids.length === 0) {
    return { categories, gender, categoryId, total, candidates: [], note: '这个分类暂时没有榜单。' }
  }
  const { books, failures } = await loadBooks(ids)
  return {
    categories,
    gender,
    categoryId,
    total,
    candidates: books,
    note: failures > 0 ? `${failures} 本书的详情没有读出来，已跳过。` : undefined,
  }
}

// ===== 关键词检索 =====

const BING_ANCHOR = /<h2><a[^>]*href="([^"]+)"[^>]*>/g
const FANQIE_BOOK_IN_URL = /^https?:\/\/fanqienovel\.com\/(?:page|reader)\/(\d{8,})/

async function bingBookIds(keyword: string): Promise<string[]> {
  const query = encodeURIComponent(`site:fanqienovel.com ${keyword} 小说`)
  const html = await fetchText(`https://cn.bing.com/search?q=${query}&count=20&setlang=zh-CN`, {
    maxBytes: SEARCH_PAGE_MAX_BYTES,
  })
  const ids: string[] = []
  for (const match of html.matchAll(BING_ANCHOR)) {
    const bookId = FANQIE_BOOK_IN_URL.exec(match[1])?.[1]
    if (bookId && !ids.includes(bookId)) ids.push(bookId)
  }
  return ids
}

/** 关键词检索：先按书号直取，再用 Bing 站内检索，最后用榜单书名兜底。 */
export async function searchFanqieBooks(keyword: string): Promise<FanqieSearchResult> {
  const trimmed = keyword.trim()
  if (!trimmed) {
    throw new FanqieLibraryError('NOT_FOUND', text('请输入书名、关键词或番茄书籍链接', 'Enter a title, keyword, or Fanqie book link'))
  }

  const directId = parseFanqieBookId(trimmed)
  if (directId) {
    return { source: 'link', candidates: [await loadFanqieBook(directId)] }
  }

  let ids: string[] = []
  let note: string | undefined
  try {
    ids = await bingBookIds(trimmed)
  } catch (error) {
    note = error instanceof Error ? `站内检索不可用（${error.message}），已改用榜单里的书名。` : '站内检索不可用，已改用榜单里的书名。'
  }

  if (ids.length > 0) {
    const { books, failures } = await loadBooks(ids.slice(0, SEARCH_CANDIDATE_LIMIT))
    if (books.length > 0) {
      return { source: 'keyword', candidates: books, note: failures > 0 ? `${failures} 本书的详情没有读出来，已跳过。` : undefined }
    }
    note ??= '检索到的书籍详情没有读出来，已改用榜单里的书名。'
  }

  const rank = await loadFanqieRank()
  const matched = rank.candidates.filter(book => book.bookName.includes(trimmed) || book.author.includes(trimmed))
  if (matched.length === 0) {
    throw new FanqieLibraryError('NOT_FOUND', text(
      `没有找到与“${trimmed}”相关的作品，可以直接粘贴番茄书籍链接`,
      `No book matching "${trimmed}" was found; paste a Fanqie book link instead`,
    ))
  }
  return { source: 'rank', candidates: matched, note: note ?? '这些是榜单里书名匹配的作品。' }
}
