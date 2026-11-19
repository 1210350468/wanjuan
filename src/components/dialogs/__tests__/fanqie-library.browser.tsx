import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useLLMStore } from '../../../stores/llm-store'
import FanqieLibraryDialog from '../FanqieLibraryDialog'
import type { FanqieBookSummary } from '../../../shared/fanqie'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
const invoke = vi.fn()
const originalLocaleState = useLocaleStore.getState()
const originalLLMState = useLLMStore.getState()

function summary(overrides: Partial<FanqieBookSummary> = {}): FanqieBookSummary {
  return {
    bookId: '7143038691944959011',
    bookName: '十日终焉',
    author: '杀虫队队员',
    tags: ['悬疑脑洞', '推理'],
    abstract: '寻常的一天里，规则开始生效。',
    wordNumber: 3_201_288,
    chapterCount: 1496,
    status: 'completed',
    readCount: 1_713_524,
    lastChapterTitle: '终',
    coverUrl: 'https://p3-reading-sign.fqnovelpic.com/novel-pic/cover.jpg',
    chapterTitleSamples: ['第1章 空屋'],
    ...overrides,
  }
}

const candidates = [
  summary(),
  summary({ bookId: '7000000000000000002', bookName: '规则怪谈', tags: ['悬疑脑洞', '规则怪谈'], chapterCount: 420, wordNumber: 900_000 }),
]

const rankPage = (gender: 1 | 2, categoryId: string) => ({
  categories: {
    male: [{ id: '1141', name: '西方奇幻' }, { id: '1140', name: '东方仙侠' }],
    female: [{ id: '1139', name: '古风世情' }],
  },
  gender,
  categoryId,
  total: 100,
  candidates,
})

beforeEach(async () => {
  invoke.mockImplementation(async (channel: string, payload?: { gender?: 1 | 2; categoryId?: string }) => {
    if (channel === 'fanqie:search') return { success: true, result: { source: 'keyword', candidates } }
    if (channel === 'fanqie:rank') return { success: true, result: rankPage(payload?.gender ?? 1, payload?.categoryId || '1141') }
    if (channel === 'dialog:select-folder') return { grantId: 'grant-1', displayName: '我的小说' }
    if (channel === 'llm:complete-once') return { success: true, text: '第一条方向：悬疑骨架，节奏更快。\n第二条方向：加入都市日常，主打成长。' }
    throw new Error(`Unexpected IPC channel ${channel}`)
  })
  Object.defineProperty(window, 'aiNovelAPI', {
    configurable: true,
    value: { invoke, on: () => () => {}, once: () => {}, send: () => {} },
  })
  useLocaleStore.setState({ locale: 'zh-CN' })
  useLLMStore.setState({ ...originalLLMState, models: [], currentModelId: null } as never)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<FanqieLibraryDialog open onClose={() => undefined} />))
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  useLocaleStore.setState(originalLocaleState)
  useLLMStore.setState(originalLLMState)
  useProjectStore.setState({ currentProject: null })
  vi.restoreAllMocks()
})

describe('番茄书库', () => {
  it('按关键词搜索后列出书名、标签与规模', async () => {
    await page.getByLabelText('书名、关键词或书籍链接').fill('十日终焉')
    await act(async () => page.getByRole('button', { name: '搜索' }).click())
    expect(invoke).toHaveBeenCalledWith('fanqie:search', '十日终焉')
    const list = page.getByRole('list', { name: '书籍结果' })
    await expect.element(list.getByText('十日终焉', { exact: true })).toBeVisible()
    await expect.element(list.getByText(/悬疑脑洞、推理/u)).toBeVisible()
    await expect.element(list.getByText(/1496 章 · 3,201,288 字 · 完结/u)).toBeVisible()
    await expect.element(list.getByText('规则怪谈', { exact: true })).toBeVisible()
  })

  it('分类榜单按男频女频与题材切换，并列出封面', async () => {
    await act(async () => page.getByRole('button', { name: '分类榜单' }).click())
    expect(invoke).toHaveBeenCalledWith('fanqie:rank', { gender: 1 })
    await expect.element(page.getByRole('list', { name: '书籍结果' }).getByText('规则怪谈', { exact: true })).toBeVisible()

    await act(async () => page.getByRole('button', { name: '东方仙侠' }).click())
    expect(invoke).toHaveBeenCalledWith('fanqie:rank', { gender: 1, categoryId: '1140' })

    await act(async () => page.getByRole('button', { name: '女频' }).click())
    expect(invoke).toHaveBeenCalledWith('fanqie:rank', { gender: 2 })

    const covers = document.querySelectorAll('ul[aria-label="书籍结果"] img')
    expect(covers.length).toBeGreaterThan(0)
  })

  it('勾选两本才允许融合，未配置模型时给出明确提示', async () => {
    await page.getByLabelText('书名、关键词或书籍链接').fill('十日终焉')
    await act(async () => page.getByRole('button', { name: '搜索' }).click())
    const fuseButton = page.getByRole('button', { name: '融合并新建作品' })
    await expect.element(fuseButton).toBeDisabled()

    const list = page.getByRole('list', { name: '书籍结果' })
    await act(async () => list.getByText('十日终焉', { exact: true }).click())
    await expect.element(page.getByText('已选 1 本（最多 5 本）')).toBeVisible()
    await expect.element(fuseButton).toBeDisabled()
    await act(async () => list.getByText('规则怪谈', { exact: true }).click())
    await expect.element(page.getByText('已选 2 本（最多 5 本）')).toBeVisible()
    await expect.element(fuseButton).toBeEnabled()

    await page.getByLabelText('新作品名称').fill('悬疑融合')
    await act(async () => page.getByRole('button', { name: '选择保存位置' }).click())
    await expect.element(page.getByText('我的小说')).toBeVisible()
    await act(async () => fuseButton.click())
    await expect.element(page.getByText(/请先在设置里配置 AI 模型/u)).toBeVisible()
    expect(invoke).not.toHaveBeenCalledWith('project:create', expect.anything())
  })

  it('勾选之后给出这套组合的题材、规模与风险提示', async () => {
    await page.getByLabelText('书名、关键词或书籍链接').fill('十日终焉')
    await act(async () => page.getByRole('button', { name: '搜索' }).click())
    const list = page.getByRole('list', { name: '书籍结果' })
    await act(async () => list.getByText('十日终焉', { exact: true }).click())
    await act(async () => list.getByText('规则怪谈', { exact: true }).click())

    await expect.element(page.getByText(/这套组合：悬疑脑洞/u)).toBeVisible()
    await expect.element(page.getByText(/规模：300 章 × 每章约 2,100 字/u)).toBeVisible()
    await expect.element(page.getByText(/标签重合 50%，骨架一致，还能各带一点新意。/u)).toBeVisible()
    await expect.element(page.getByText(/每章 2,100 字，比平台主流短/u)).toBeVisible()

    // 多维度评分：综合分 + 五个分项，勾选之后就能看到。
    const scorePanel = page.getByLabelText('这套组合的评分')
    await expect.element(scorePanel.getByText('综合', { exact: true })).toBeVisible()
    await expect.element(scorePanel.getByText('92', { exact: true })).toBeVisible()
    for (const label of ['题材集中', '热度', '追读', '结构', '节奏']) {
      await expect.element(scorePanel.getByText(label, { exact: true })).toBeVisible()
    }
  })

  it('每张候选卡片直接给出综合评分，挑书前就能比', async () => {
    await page.getByLabelText('书名、关键词或书籍链接').fill('十日终焉')
    await act(async () => page.getByRole('button', { name: '搜索' }).click())
    const list = page.getByRole('list', { name: '书籍结果' })
    const badges = list.element().querySelectorAll('span[title^="综合评分"]')
    expect(badges).toHaveLength(2)
    expect(Number(badges[0].textContent)).toBeGreaterThan(0)
    expect(Number(badges[0].textContent)).toBeLessThanOrEqual(100)
  })

  it('帮我配一单：一键选好参考作品并说明为什么这么配', async () => {
    await page.getByLabelText('书名、关键词或书籍链接').fill('十日终焉')
    await act(async () => page.getByRole('button', { name: '搜索' }).click())

    await act(async () => page.getByRole('button', { name: '帮我配一单' }).click())
    await expect.element(page.getByText('已选 2 本（最多 5 本）')).toBeVisible()
    await expect.element(page.getByText(/配了 2 本：《/u)).toBeVisible()
    await expect.element(page.getByText(/共同 悬疑脑洞/u)).toBeVisible()
    await expect.element(page.getByRole('button', { name: '融合并新建作品' })).toBeEnabled()
    // 没手动起名时先用推荐名占位，融合不会被名字挡住。
    await expect.element(page.getByLabelText('新作品名称')).toHaveValue('悬疑脑洞融合')

    // 手动改选之后，上一单的说明不再挂着。
    const list = page.getByRole('list', { name: '书籍结果' })
    await act(async () => list.getByText('规则怪谈', { exact: true }).click())
    await expect.element(page.getByText('已选 1 本（最多 5 本）')).toBeVisible()
    expect(document.body.textContent).not.toContain('配了 2 本')
  })

  it('AI 定方向把两条候选写出来，点一条填进融合取向', async () => {
    useLLMStore.setState({
      ...originalLLMState,
      models: [{ id: 'model-1', name: '测试模型', purposes: ['generation'] }],
      defaultModelId: 'model-1',
      stageModelIds: {},
    } as never)

    await page.getByLabelText('书名、关键词或书籍链接').fill('十日终焉')
    await act(async () => page.getByRole('button', { name: '搜索' }).click())
    const list = page.getByRole('list', { name: '书籍结果' })
    await act(async () => list.getByText('十日终焉', { exact: true }).click())
    await act(async () => list.getByText('规则怪谈', { exact: true }).click())

    await act(async () => page.getByRole('button', { name: 'AI 定方向' }).click())
    expect(invoke).toHaveBeenCalledWith('llm:complete-once', expect.objectContaining({ modelId: 'model-1' }))
    await expect.element(page.getByRole('button', { name: '第一条方向：悬疑骨架，节奏更快。' })).toBeVisible()

    const focus = page.getByLabelText('融合取向（可留空）')
    await expect.element(focus).toHaveValue('第一条方向：悬疑骨架，节奏更快。')
    await act(async () => page.getByRole('button', { name: '第二条方向：加入都市日常，主打成长。' }).click())
    await expect.element(focus).toHaveValue('第二条方向：加入都市日常，主打成长。')
  })
})
