import { describe, expect, it, vi } from 'vitest'
import { buildHarnessInvocation, CliHarnessProvider } from '../cli-harness-provider'
import type { ModelProfile } from '../../../src/shared/ipc-channels'

/** 用 node 自己当执行器：读 stdin 原样大写回写，不依赖任何外部 CLI。 */
const UPPERCASE_SCRIPT = "process.stdout.write(require('fs').readFileSync(0,'utf8').toUpperCase())"

function harnessModel(args: string[]): ModelProfile {
  return {
    id: 'harness-1',
    name: '本机执行器',
    provider: 'harness',
    protocol: 'cli',
    modelName: 'node',
    apiKey: '',
    baseUrl: '',
    temperature: 0.7,
    maxTokens: 1000,
    purposes: ['generation'],
    harness: { command: process.execPath, args },
  }
}

const options = (signal?: AbortSignal) => ({ temperature: undefined, maxTokens: 100, signal })

describe('buildHarnessInvocation', () => {
  it('参数里没有占位符时，提示词从 stdin 进', () => {
    const invocation = buildHarnessInvocation({ harness: { command: 'codex', args: ['exec'] } }, '写一段开场')
    expect(invocation.argv).toEqual(['codex', 'exec'])
    expect(invocation.stdin).toBe('写一段开场')
  })

  it('参数里有 {{prompt}} 时替换到该位置，不再走 stdin', () => {
    const invocation = buildHarnessInvocation({ harness: { command: 'gemini', args: ['-p', '{{prompt}}'] } }, '写一段开场')
    expect(invocation.argv).toEqual(['gemini', '-p', '写一段开场'])
    expect(invocation.stdin).toBeUndefined()
  })

  it('没填命令时直接失败，不猜一个默认执行器', () => {
    expect(() => buildHarnessInvocation({ harness: { command: '   ', args: [] } }, 'x')).toThrow()
    expect(() => buildHarnessInvocation({}, 'x')).toThrow()
  })
})

describe('CliHarnessProvider', () => {
  it('非流式：提示词走 stdin，返回执行器的完整输出', async () => {
    const provider = new CliHarnessProvider()
    const response = await provider.generate(harnessModel(['-e', UPPERCASE_SCRIPT]), [{ role: 'user', content: 'hello' }], options())
    expect(response.success).toBe(true)
    expect(response.content).toBe('HELLO')
  })

  it('非流式：非零退出码算失败，报错带上退出码', async () => {
    const provider = new CliHarnessProvider()
    const response = await provider.generate(harnessModel(['-e', 'process.exit(3)']), [{ role: 'user', content: 'hello' }], options())
    expect(response.success).toBe(false)
    expect(response.error).toContain('3')
  })

  it('流式：按块交付并在结束时给出完整文本', async () => {
    const provider = new CliHarnessProvider()
    const chunks: string[] = []
    const done = vi.fn()
    await provider.generateStream(
      harnessModel(['-e', UPPERCASE_SCRIPT]),
      [{ role: 'user', content: 'abc' }],
      {
        ...options(),
        signal: new AbortController().signal,
        onChunk: chunk => chunks.push(chunk),
        onDone: done,
        onError: (error) => { throw new Error(error) },
      },
    )
    expect(chunks.join('')).toBe('ABC')
    expect(done).toHaveBeenCalledWith('ABC', undefined, 'stop')
  })

  it('流式：非零退出码走 onError，已产出的内容一起交出去', async () => {
    const provider = new CliHarnessProvider()
    const onError = vi.fn()
    await provider.generateStream(
      harnessModel(['-e', "process.stdout.write('partial');process.exit(2)"]),
      [{ role: 'user', content: 'abc' }],
      {
        ...options(),
        signal: new AbortController().signal,
        onChunk: () => undefined,
        onDone: () => { throw new Error('should not finish') },
        onError,
      },
    )
    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0][1]).toBe('partial')
  })
})
