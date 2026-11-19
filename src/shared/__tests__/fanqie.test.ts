import { describe, expect, it } from 'vitest'
import {
  buildFanqieFusionBrief,
  buildFanqieSelectionInsight,
  FANQIE_FUSION_MAX_BOOKS,
  FANQIE_TITLE_SAMPLE_LIMIT,
  parseFanqieBookId,
  sampleChapterTitles,
  suggestFanqieBundle,
  type FanqieBookSummary,
} from '../fanqie'

function book(overrides: Partial<FanqieBookSummary> = {}): FanqieBookSummary {
  return {
    bookId: '7143038691944959011',
    bookName: '十日终焉',
    author: '杀虫队队员',
    tags: ['悬疑脑洞', '推理', '无限流'],
    abstract: '当我以为这只是寻常的一天时，却发现自己是故事的一部分。',
    wordNumber: 3_201_288,
    chapterCount: 1496,
    status: 'completed',
    readCount: 1_713_524,
    lastChapterTitle: '陈俊南（终）',
    chapterTitleSamples: ['第1章 空屋', '第2章 说谎', '第3章 有技术的人'],
    ...overrides,
  }
}

describe('parseFanqieBookId', () => {
  it('接受书籍页、阅读页与纯书号', () => {
    expect(parseFanqieBookId('https://fanqienovel.com/page/7143038691944959011')).toBe('7143038691944959011')
    expect(parseFanqieBookId('https://fanqienovel.com/reader/7173216089122439711?x=1')).toBe('7173216089122439711')
    expect(parseFanqieBookId('  7143038691944959011 ')).toBe('7143038691944959011')
  })

  it('拒绝其他站点、其他路径与过短的数字', () => {
    expect(parseFanqieBookId('https://example.com/page/7143038691944959011')).toBeNull()
    expect(parseFanqieBookId('https://fanqienovel.com/rank')).toBeNull()
    expect(parseFanqieBookId('12345')).toBeNull()
    expect(parseFanqieBookId('十日终焉')).toBeNull()
  })
})

describe('sampleChapterTitles', () => {
  it('短列表原样保留', () => {
    const titles = ['第1章 空屋', '第2章 说谎']
    expect(sampleChapterTitles(titles)).toEqual(titles)
  })

  it('长列表保留开局、收尾并按上限抽样', () => {
    const titles = Array.from({ length: 1200 }, (_, index) => `第${index + 1}章 事件${index + 1}`)
    const sampled = sampleChapterTitles(titles)
    expect(sampled.length).toBeLessThanOrEqual(FANQIE_TITLE_SAMPLE_LIMIT)
    expect(sampled.slice(0, 40)).toEqual(titles.slice(0, 40))
    expect(sampled.slice(-8)).toEqual(titles.slice(-8))
    for (const title of sampled) expect(titles).toContain(title)
  })
})

describe('buildFanqieFusionBrief', () => {
  it('取参考作品的中位规模，并写出共同标签与独有标签', () => {
    const brief = buildFanqieFusionBrief([
      book(),
      book({ bookId: '7000000000000000002', bookName: '规则怪谈', tags: ['悬疑脑洞', '规则怪谈'], chapterCount: 400, wordNumber: 800_000 }),
      book({ bookId: '7000000000000000003', bookName: '求生实录', tags: ['悬疑脑洞', '求生'], chapterCount: 200, wordNumber: 400_000 }),
    ])
    expect(brief.totalChapters).toBe(300)
    expect(brief.wordsPerChapter).toBe(2000)
    expect(brief.suggestedTitle).toBe('悬疑脑洞融合')
    expect(brief.idea).toContain('共同标签：悬疑脑洞')
    expect(brief.idea).toContain('《规则怪谈》：规则怪谈')
    expect(brief.idea).toContain('不得复刻其中的人物、地名、组织名或具体情节')
  })

  it('把作者的融合取向写进简报', () => {
    const brief = buildFanqieFusionBrief([book(), book({ bookName: '第二本' })], '保留悬疑结构，节奏更快')
    expect(brief.idea).toContain('作者的融合取向：保留悬疑结构，节奏更快')
  })

  it('规模限制在可写完的长篇范围', () => {
    const brief = buildFanqieFusionBrief([book({ chapterCount: 5000, wordNumber: 35_000_000 }), book({ chapterCount: 4000, wordNumber: 28_000_000 })])
    expect(brief.totalChapters).toBe(300)
    expect(brief.wordsPerChapter).toBe(6000)
  })

  it('章数太少的参考作品按最短长篇来规划', () => {
    const brief = buildFanqieFusionBrief([book({ chapterCount: 4, wordNumber: 4000 }), book({ chapterCount: 6, wordNumber: 6000 })])
    expect(brief.totalChapters).toBe(30)
    expect(brief.wordsPerChapter).toBe(1500)
  })

  it('没有可行参考时直接失败，超过上限也失败', () => {
    expect(() => buildFanqieFusionBrief([])).toThrow('FANQIE_SELECTION_EMPTY')
    const many = Array.from({ length: FANQIE_FUSION_MAX_BOOKS + 1 }, (_, index) => book({ bookId: `70000000000000000${index}` }))
    expect(() => buildFanqieFusionBrief(many)).toThrow('FANQIE_SELECTION_TOO_MANY')
  })
})

describe('buildFanqieSelectionInsight', () => {
  it('题材取共同标签，规模与融合简报一致', () => {
    const insight = buildFanqieSelectionInsight([
      book(),
      book({ bookId: '7000000000000000002', bookName: '规则怪谈', tags: ['悬疑脑洞', '规则怪谈'], chapterCount: 400, wordNumber: 800_000 }),
      book({ bookId: '7000000000000000003', bookName: '求生实录', tags: ['悬疑脑洞', '求生'], chapterCount: 200, wordNumber: 400_000 }),
    ])
    expect(insight.primaryTag).toBe('悬疑脑洞')
    expect(insight.sharedTags).toEqual(['悬疑脑洞'])
    expect(insight.overlap).toBe(0.2)
    expect(insight.totalChapters).toBe(300)
    expect(insight.wordsPerChapter).toBe(2000)
    expect(insight.medianReads).toBe(1_713_524)
    expect(insight.completedCount).toBe(3)
    expect(insight.density).toBe('thin')
    expect(insight.blend).toBe('balanced')
  })

  it('标签完全不重合时判为题材分散', () => {
    const insight = buildFanqieSelectionInsight([
      book({ tags: ['悬疑脑洞', '推理'] }),
      book({ bookId: '7000000000000000002', tags: ['都市日常', '种田'] }),
    ])
    expect(insight.overlap).toBe(0)
    expect(insight.blend).toBe('scattered')
    expect(insight.primaryTag).toBe('悬疑脑洞')
  })

  it('标签完全重合时判为同质', () => {
    const insight = buildFanqieSelectionInsight([
      book(),
      book({ bookId: '7000000000000000002', tags: ['悬疑脑洞', '推理', '无限流'] }),
    ])
    expect(insight.overlap).toBe(1)
    expect(insight.blend).toBe('identical')
  })

  it('快节奏的单本参考判为偏薄，长章判为偏厚', () => {
    expect(buildFanqieSelectionInsight([book({ chapterCount: 2000, wordNumber: 3_000_000 })]).density).toBe('thin')
    expect(buildFanqieSelectionInsight([book({ chapterCount: 100, wordNumber: 500_000 })]).density).toBe('thick')
  })

  it('没有参考作品时直接失败，超过上限也失败', () => {
    expect(() => buildFanqieSelectionInsight([])).toThrow('FANQIE_SELECTION_EMPTY')
    const many = Array.from({ length: FANQIE_FUSION_MAX_BOOKS + 1 }, (_, index) => book({ bookId: `70000000000000000${index}` }))
    expect(() => buildFanqieSelectionInsight(many)).toThrow('FANQIE_SELECTION_TOO_MANY')
  })
})

describe('suggestFanqieBundle', () => {
  const candidates: FanqieBookSummary[] = [
    book({ bookId: '7000000000000000001', bookName: '十日终焉', tags: ['悬疑脑洞', '推理', '无限流'], readCount: 1_713_524 }),
    book({ bookId: '7000000000000000002', bookName: '规则怪谈', tags: ['悬疑脑洞', '规则怪谈', '都市'], readCount: 902_000, chapterCount: 600, wordNumber: 1_800_000, status: 'ongoing' }),
    book({ bookId: '7000000000000000003', bookName: '刑侦档案', tags: ['悬疑脑洞', '刑侦', '破案'], readCount: 1_204_000, chapterCount: 800, wordNumber: 2_400_000 }),
    book({ bookId: '7000000000000000004', bookName: '都市种田', tags: ['都市日常', '种田', '轻松'], readCount: 6_800_000, chapterCount: 900, wordNumber: 2_700_000 }),
    book({ bookId: '7000000000000000005', bookName: '冷门推理', tags: ['悬疑', '推理'], readCount: 1_100, chapterCount: 120, wordNumber: 260_000 })
  ]

  it('配出一单：留共同标签当骨架，带进独有标签，跳过跑偏的爆款', () => {
    const suggestion = suggestFanqieBundle(candidates)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.books).toHaveLength(3)
    const names = suggestion!.books.map(entry => entry.bookName)
    expect(names[0]).toBe('十日终焉')
    expect(names).not.toContain('都市种田')
    expect(suggestion!.sharedTags).toEqual(['悬疑脑洞'])
    expect(suggestion!.addedTags.length).toBeGreaterThan(0)
    expect(suggestion!.addedTags).not.toContain('悬疑脑洞')
    expect(suggestion!.alternatives).toBeGreaterThanOrEqual(1)
  })

  it('候选少于两本时给不出建议', () => {
    expect(suggestFanqieBundle([])).toBeNull()
    expect(suggestFanqieBundle([candidates[0]])).toBeNull()
  })

  it('候选很少时配满候选，不重复同一本', () => {
    const suggestion = suggestFanqieBundle([candidates[0], candidates[0], candidates[2]], 3)
    expect(suggestion!.books.map(entry => entry.bookId)).toEqual(['7000000000000000001', '7000000000000000003'])
    expect(suggestion!.alternatives).toBe(0)
  })

  it('候选很多时最多配到上限', () => {
    const many = Array.from({ length: 9 }, (_, index) => book({
      bookId: `70000000000000001${index}`,
      bookName: `悬疑${index}`,
      tags: ['悬疑脑洞', `卖点${index}`],
      readCount: 500_000 + index * 1000,
    }))
    const suggestion = suggestFanqieBundle(many, FANQIE_FUSION_MAX_BOOKS + 3)
    expect(suggestion!.books).toHaveLength(FANQIE_FUSION_MAX_BOOKS)
    expect(new Set(suggestion!.books.map(entry => entry.bookId)).size).toBe(FANQIE_FUSION_MAX_BOOKS)
  })

  it('标签完全相同时没有新增卖点，但照样能配', () => {
    const twin = book({ bookId: '7000000000000000002' })
    const suggestion = suggestFanqieBundle([book(), twin], 2)
    expect(suggestion!.books).toHaveLength(2)
    expect(suggestion!.sharedTags).toEqual(['悬疑脑洞', '推理', '无限流'])
    expect(suggestion!.addedTags).toEqual([])
  })
})
