import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelProfile } from '../../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../../shared/provider-presets'
import type { HarnessCandidate } from '../../../shared/harness'
import { useLocaleStore } from '../../../stores/locale-store'
import { ModelForm } from '../ModelForm'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalLocaleState = useLocaleStore.getState()
let root: Root | undefined
let container: HTMLDivElement | undefined

const candidate = (overrides: Partial<HarnessCandidate> & Pick<HarnessCandidate, 'id'>): HarnessCandidate => ({
  command: overrides.id,
  args: ['exec', '{{prompt}}'],
  installed: true,
  resolvedPath: `C:/bin/${overrides.id}.cmd`,
  version: '0.48.0',
  auth: 'signed-in',
  loginCommand: `${overrides.id} login`,
  interactive: false,
  ...overrides,
})

const DETECTED: HarnessCandidate[] = [
  candidate({ id: 'codex' }),
  candidate({ id: 'claude', auth: 'signed-out', loginCommand: 'claude' }),
  candidate({ id: 'gemini', installed: false, resolvedPath: undefined, version: undefined, auth: 'signed-out' }),
  candidate({ id: 'agy', auth: 'unknown', loginCommand: 'agy', interactive: true }),
]

async function renderHarnessForm() {
  useLocaleStore.setState({ locale: 'zh-CN' })
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'harness:detect') return { success: true, detection: { candidates: DETECTED, platform: 'win32' } }
    if (channel === 'harness:login') return { success: true, command: 'claude' }
    throw new Error(`Unexpected IPC channel ${channel}`)
  })
  Object.defineProperty(window, 'aiNovelAPI', {
    configurable: true,
    value: { invoke, on: () => () => {}, once: () => {}, send: () => {} },
  })
  const onChange = vi.fn()
  const model: ModelProfile = {
    id: 'harness-model', name: '', provider: 'harness', protocol: 'cli', modelName: '', apiKey: '', baseUrl: '',
    temperature: 0.7, maxTokens: 4000, purposes: ['generation'], harness: { command: '', args: [] },
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(
    <ModelForm model={model} onChange={onChange} onSave={vi.fn()} onCancel={vi.fn()} saving={false} purposeOptions={['generation']} presets={BUILTIN_PRESETS} />,
  ))
  return { invoke, onChange }
}

const row = (id: string) => container?.querySelector(`[data-harness-row="${id}"]`) as HTMLElement | null

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  useLocaleStore.setState(originalLocaleState)
})

describe('本机执行器检测', () => {
  it('打开表单就检测一次，并把装没装、登录没登录写在行里', async () => {
    const { invoke } = await renderHarnessForm()
    await vi.waitFor(() => expect(row('codex')).not.toBeNull())
    expect(invoke).toHaveBeenCalledWith('harness:detect')
    expect(row('codex')?.textContent).toContain('已安装')
    expect(row('codex')?.textContent).toContain('0.48.0')
    expect(row('codex')?.textContent).toContain('已登录')
    expect(row('claude')?.textContent).toContain('没找到登录凭据')
    expect(row('gemini')?.textContent).toContain('未安装')
    expect(row('agy')?.textContent).toContain('登录状态未知')
    // 能直接用的排在最前，没装的垫底。
    const order = [...container!.querySelectorAll('[data-harness-row]')].map(node => node.getAttribute('data-harness-row'))
    expect(order[0]).toBe('codex')
    expect(order.at(-1)).toBe('gemini')
  })

  it('点「用这个」直接把命令与参数填进模型配置', async () => {
    const { onChange } = await renderHarnessForm()
    await vi.waitFor(() => expect(row('codex')).not.toBeNull())
    const use = [...row('codex')!.querySelectorAll('button')].find(button => button.textContent?.includes('用这个'))
    await act(async () => use?.click())
    const last = onChange.mock.calls.at(-1)?.[0] as ModelProfile
    expect(last.provider).toBe('harness')
    expect(last.protocol).toBe('cli')
    expect(last.harness).toEqual({ command: 'codex', args: ['exec', '{{prompt}}'] })
    expect(last.modelName).toBe('codex')
  })

  it('没登录的执行器给「登录」，点了就交给终端并提示回来重新检测', async () => {
    const { invoke } = await renderHarnessForm()
    await vi.waitFor(() => expect(row('claude')).not.toBeNull())
    const signIn = [...row('claude')!.querySelectorAll('button')].find(button => button.textContent?.includes('登录'))
    await act(async () => signIn?.click())
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('harness:login', { id: 'claude' }))
    await vi.waitFor(() => expect(container?.textContent).toContain('已尝试在终端打开 claude'))
    expect(container?.textContent).toContain('请自己打开终端运行 claude')
  })

  it('检测接口报错时说明原因，不留一片空白', async () => {
    useLocaleStore.setState({ locale: 'zh-CN' })
    const invoke = vi.fn(async () => ({ success: false, error: '没能检查本机执行器，请稍后再试' }))
    Object.defineProperty(window, 'aiNovelAPI', {
      configurable: true,
      value: { invoke, on: () => () => {}, once: () => {}, send: () => {} },
    })
    const model: ModelProfile = {
      id: 'harness-model', name: '', provider: 'harness', protocol: 'cli', modelName: '', apiKey: '', baseUrl: '',
      temperature: 0.7, maxTokens: 4000, purposes: ['generation'], harness: { command: '', args: [] },
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(
      <ModelForm model={model} onChange={vi.fn()} onSave={vi.fn()} onCancel={vi.fn()} saving={false} purposeOptions={['generation']} presets={BUILTIN_PRESETS} />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('没能检查本机执行器'))
  })
})
