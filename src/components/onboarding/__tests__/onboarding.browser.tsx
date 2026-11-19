import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { useLocaleStore } from '../../../stores/locale-store'
import OnboardingGuide from '../OnboardingGuide'
import { hasSeenOnboarding, markOnboardingSeen, ONBOARDING_STORAGE_KEY } from '../onboarding-state'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
const onClose = vi.fn()
const originalLocaleState = useLocaleStore.getState()

beforeEach(async () => {
  localStorage.removeItem(ONBOARDING_STORAGE_KEY)
  onClose.mockReset()
  useLocaleStore.setState({ locale: 'zh-CN' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<OnboardingGuide open onClose={onClose} />))
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  localStorage.removeItem(ONBOARDING_STORAGE_KEY)
  useLocaleStore.setState(originalLocaleState)
  vi.restoreAllMocks()
})

describe('新手引导', () => {
  it('四步走完，最后一步开始写就关闭', async () => {
    await expect.element(page.getByRole('heading', { name: '欢迎用万卷' })).toBeVisible()
    await expect.element(page.getByText('第 1 步，共 4 步')).toBeVisible()

    await act(async () => page.getByRole('button', { name: '下一步' }).click())
    await expect.element(page.getByRole('heading', { name: '先让 AI 就位' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: '去配置模型' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: '上一步' })).toBeVisible()

    await act(async () => page.getByRole('button', { name: '下一步' }).click())
    await expect.element(page.getByRole('heading', { name: '去哪儿找参考' })).toBeVisible()
    await expect.element(page.getByText(/19 \+ 18 个题材榜单/u)).toBeVisible()

    await act(async () => page.getByRole('button', { name: '下一步' }).click())
    await expect.element(page.getByRole('heading', { name: '一部作品怎么写完' })).toBeVisible()
    await expect.element(page.getByText('1. 设定')).toBeVisible()

    await act(async () => page.getByRole('button', { name: '开始写' }).click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('记住看过，之后不再自动弹出', async () => {
    expect(hasSeenOnboarding()).toBe(false)
    await act(async () => page.getByRole('button', { name: '跳过引导' }).click())
    expect(onClose).toHaveBeenCalledOnce()

    // 组件本身只通知外层关闭，标记由 App 在 onClose 里写。
    markOnboardingSeen()
    expect(hasSeenOnboarding()).toBe(true)
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('done')
  })
})
