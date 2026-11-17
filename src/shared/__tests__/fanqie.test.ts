import { describe, expect, it } from 'vitest'
import {
  buildFanqieFusionBrief,
  FANQIE_FUSION_MAX_BOOKS,
  FANQIE_TITLE_SAMPLE_LIMIT,
  parseFanqieBookId,
  sampleChapterTitles,
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
    expect(() => buildFanqieFusionBrief([])).toThrow('融合简报需要至少一部参考作品')
    const many = Array.from({ length: FANQIE_FUSION_MAX_BOOKS + 1 }, (_, index) => book({ bookId: `70000000000000000${index}` }))
    expect(() => buildFanqieFusionBrief(many)).toThrow(`一次最多融合 ${FANQIE_FUSION_MAX_BOOKS} 部参考作品`)
  })
})
