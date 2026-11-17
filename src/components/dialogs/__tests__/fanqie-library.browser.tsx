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
})
