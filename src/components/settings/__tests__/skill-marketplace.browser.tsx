import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { useLocaleStore } from '../../../stores/locale-store'
import SkillMarketplaceDialog from '../SkillMarketplaceDialog'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
const invoke = vi.fn()
const originalLocaleState = useLocaleStore.getState()

const scan = {
  owner: 'sleepykino',
  repo: 'One-flower',
  ref: 'OneFlower',
  truncated: false,
  candidates: [
    {
      path: 'skills/show-dont-tell/SKILL.md',
      sourceUrl: 'https://github.com/sleepykino/One-flower/blob/OneFlower/skills/show-dont-tell/SKILL.md',
      name: 'show-dont-tell',
      displayName: '展示代替直说',
      description: '用动作与细节代替情绪直陈。',
      language: 'zh-CN',
      suggestedStage: 'refinement',
      bundledReferences: 0,
      missingReferences: 0,
      blockingReasons: [],
      utf8Bytes: 1237,
    },
    {
      path: 'skills/story-scan/SKILL.md',
      sourceUrl: 'https://github.com/sleepykino/One-flower/blob/OneFlower/skills/story-scan/SKILL.md',
      name: 'story-scan',
      description: '需要运行脚本生成榜单。',
      language: 'zh-CN',
      suggestedStage: 'planning',
      bundledReferences: 2,
      missingReferences: 0,
      blockingReasons: ['script-dependency'],
      utf8Bytes: 2400,
    },
  ],
}

beforeEach(async () => {
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'skills:scan-repo') return { success: true, scan }
    if (channel === 'skills:search-repos') {
      return {
        success: true,
        repositories: [
          {
            owner: 'sleepykino',
            repo: 'One-flower',
            fullName: 'sleepykino/One-flower',
            description: '一花一世界，AI 小说创作工具。',
            stars: 11,
            updatedAt: '2026-11-01T00:00:00Z',
            defaultBranch: 'OneFlower',
          },
        ],
      }
    }
    if (channel === 'skills:inspect-github') {
      return {
        success: true,
        inspection: {
          sourceUrl: scan.candidates[0].sourceUrl,
          resolvedUrl: 'https://raw.githubusercontent.com/sleepykino/One-flower/OneFlower/skills/show-dont-tell/SKILL.md',
          contentSha256: 'a'.repeat(64),
          metadata: { name: 'show-dont-tell', description: '展示代替直说', language: 'zh-CN' },
          compatible: true,
          reasons: [],
          suggestedStage: 'refinement',
          utf8Bytes: 1237,
          bundledFiles: [],
          unbundledReferences: [],
        },
      }
    }
    if (channel === 'skills:install-github') return { success: true, skill: { name: 'show-dont-tell' } }
    throw new Error(`Unexpected IPC channel ${channel}`)
  })
  Object.defineProperty(window, 'aiNovelAPI', {
    configurable: true,
    value: { invoke, on: () => () => {}, once: () => {}, send: () => {} },
  })
  useLocaleStore.setState({ locale: 'zh-CN' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  useLocaleStore.setState(originalLocaleState)
  vi.restoreAllMocks()
})

async function render(installedNames: string[] = []) {
  const onInstalled = vi.fn(async () => undefined)
  await act(async () => root?.render(
    <SkillMarketplaceDialog open onClose={() => undefined} installedNames={installedNames} onInstalled={onInstalled} />,
  ))
  return onInstalled
}

describe('写作 Skill 超市', () => {
  it('扫描推荐仓库后列出 Skill，依赖脚本的条目标为不能安装', async () => {
    await render()
    await act(async () => page.getByRole('button', { name: /一花 · 文风与去 AI 味/u }).click())
    expect(invoke).toHaveBeenCalledWith('skills:scan-repo', 'sleepykino/One-flower')
    await expect.element(page.getByText('展示代替直说')).toBeVisible()
    await expect.element(page.getByText(/不能安装：依赖脚本/u)).toBeVisible()
    expect(page.getByRole('checkbox').elements()).toHaveLength(2)
    expect(page.getByRole('checkbox').nth(1).element()).toBeDisabled()
  })

  it('全选可安装的条目，确认后逐个检查并安装', async () => {
    const onInstalled = await render()
    await page.getByLabelText('GitHub 仓库').fill('sleepykino/One-flower')
    await act(async () => page.getByRole('button', { name: '扫描' }).click())
    await expect.element(page.getByText('展示代替直说')).toBeVisible()

    await act(async () => page.getByRole('button', { name: '全选可安装' }).click())
    await expect.element(page.getByRole('button', { name: '安装所选（1）' })).toBeEnabled()
    await act(async () => page.getByRole('button', { name: '安装所选（1）' }).click())
    await act(async () => page.getByRole('button', { name: '确认' }).click())

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('skills:install-github', scan.candidates[0].sourceUrl))
    expect(invoke).toHaveBeenCalledWith('skills:inspect-github', scan.candidates[0].sourceUrl)
    expect(onInstalled).toHaveBeenCalledOnce()
    await expect.element(page.getByText(/安装结果：成功 1 个，失败 0 个/u)).toBeVisible()
  })

  it('按关键字找仓库，带简介并可直接看技能', async () => {
    await render()
    await page.getByLabelText('按关键字找仓库').fill('网文 写作 skill')
    await act(async () => page.getByRole('button', { name: '找仓库' }).click())
    expect(invoke).toHaveBeenCalledWith('skills:search-repos', '网文 写作 skill')
    const list = page.getByRole('list', { name: '找到的仓库' })
    await expect.element(list.getByText('sleepykino/One-flower')).toBeVisible()
    await expect.element(list.getByText(/一花一世界/u)).toBeVisible()
    await expect.element(list.getByText(/11 星/u)).toBeVisible()

    await act(async () => page.getByRole('button', { name: '看技能' }).click())
    expect(invoke).toHaveBeenCalledWith('skills:scan-repo', 'sleepykino/One-flower')
    await expect.element(page.getByText('展示代替直说')).toBeVisible()
  })

  it('已安装的条目直接勾上并禁用', async () => {
    await render(['show-dont-tell'])
    await act(async () => page.getByRole('button', { name: /一花 · 文风与去 AI 味/u }).click())
    await expect.element(page.getByText('已安装')).toBeVisible()
    expect(page.getByRole('checkbox').first().element()).toBeDisabled()
    await expect.element(page.getByRole('button', { name: '安装所选（0）' })).toBeDisabled()
  })
})
