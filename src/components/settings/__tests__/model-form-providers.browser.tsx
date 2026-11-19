import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import type { ModelProfile } from '../../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../../shared/provider-presets'
import { useLocaleStore } from '../../../stores/locale-store'
import { ModelForm } from '../ModelForm'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalLocaleState = useLocaleStore.getState()
let root: Root | undefined
let container: HTMLDivElement | undefined

const ALL_PROVIDERS = ['openai', 'novelai', 'deepseek', 'gemini', 'xai', 'siliconflow', 'ollama', 'harness', 'bigmodel', 'bigmodel-anthropic', 'custom']

async function renderForm(purposes: ModelProfile['purposes']) {
  useLocaleStore.setState({ locale: 'zh-CN' })
  const onChange = vi.fn()
  const model: ModelProfile = {
    id: 'form-model', name: 'Form model', provider: 'openai', protocol: 'openai', modelName: 'm',
    apiKey: '', baseUrl: 'http://127.0.0.1:9/v1', temperature: 0.7, maxTokens: 4000, purposes,
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(
    <ModelForm model={model} onChange={onChange} onSave={vi.fn()} onCancel={vi.fn()} saving={false} purposeOptions={purposes} presets={BUILTIN_PRESETS} />,
  ))
  const providerSelect = container.querySelector('select')!
  return { onChange, providerSelect, values: [...providerSelect.options].map(option => option.value) }
}

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  useLocaleStore.setState(originalLocaleState, true)
})

it('生成模型表单列出全部服务商，作者能选到 xAI', async () => {
  const { onChange, providerSelect, values } = await renderForm(['generation'])
  expect(values).toEqual(ALL_PROVIDERS)

  await act(async () => { await page.elementLocator(providerSelect).selectOptions('xai') })
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'xai' }))
})

it('向量模型表单不列本机执行器与智谱 Anthropic', async () => {
  const { values } = await renderForm(['embedding'])
  expect(values).toEqual(ALL_PROVIDERS.filter(provider => provider !== 'bigmodel-anthropic' && provider !== 'harness'))
})

it('选本机执行器后只留执行器面板：命令必填，不用填 base_url 与 API Key', async () => {
  const { onChange, providerSelect } = await renderForm(['generation'])
  await act(async () => { await page.elementLocator(providerSelect).selectOptions('harness') })
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
    provider: 'harness',
    protocol: 'cli',
    baseUrl: '',
    apiKey: '',
  }))
})

it('执行器模型只要求命令，能直接保存', async () => {
  useLocaleStore.setState({ locale: 'zh-CN' })
  const model: ModelProfile = {
    id: 'harness-model', name: '本机执行器', provider: 'harness', protocol: 'cli', modelName: 'codex',
    apiKey: '', baseUrl: '', temperature: 0.7, maxTokens: 4000, purposes: ['generation'],
    harness: { command: 'codex', args: ['exec', '{{prompt}}'] },
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(
    <ModelForm model={model} onChange={vi.fn()} onSave={vi.fn()} onCancel={vi.fn()} saving={false} purposeOptions={['generation']} presets={BUILTIN_PRESETS} />,
  ))
  const form = container
  const saveButton = [...form.querySelectorAll('button')].find(button => button.textContent?.includes('保存配置'))!
  expect(saveButton.disabled).toBe(false)
  expect(form.textContent).not.toContain('保存前还需填写')
  expect(form.querySelector('#model-harness-command')).not.toBeNull()
  expect(form.querySelector('#model-harness-args')).not.toBeNull()
  // 执行器用不到 HTTP 服务商那几项输入：没有 base_url 输入框，也没有密码框。
  expect(form.textContent).not.toContain('base_url')
  expect(form.querySelector('input[type="password"]')).toBeNull()
})
