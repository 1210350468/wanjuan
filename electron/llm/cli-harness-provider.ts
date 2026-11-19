import { spawn } from 'node:child_process'
import type { ModelProfile } from '../../src/shared/ipc-channels'
import { localize, resolveLocale } from '../../src/i18n/core'
import type { ILLMProvider, LLMGenerateOptions, LLMResponse, LLMStreamOptions } from './provider.interface'

/**
 * 本机 agent 执行器：作者用自己已经登录的 Codex、Gemini CLI、Claude Code 这类命令行工具来跑补全，
 * 走的是订阅本身，不经过 HTTP 接口，也不需要 API Key。
 *
 * 提示词默认从 stdin 送进去；参数里写了 `{{prompt}}` 时替换到该位置。正文生成会把整段上下文拼进提示词，
 * 走参数会撞上命令行的长度上限，所以默认口径是 stdin。
 */

/** 单次输出上限：CLI 卡住不停输出时也不会把内存吃满。 */
const CLI_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024
const PROMPT_PLACEHOLDER = '{{prompt}}'
/** 失败时给作者看的 stderr 长度上限。 */
const STDERR_EXCERPT_LIMIT = 600

function text(zhCNText: string, enUSText: string): string {
  const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale
  return localize(resolveLocale(systemLocale), zhCNText, enUSText)
}

export interface HarnessInvocation {
  /** 可执行文件放在第一位，后面是参数。 */
  argv: string[]
  /** 要写进 stdin 的提示词；提示词已经作为参数传入时为 undefined。 */
  stdin?: string
}

/** 把执行器配置与提示词拼成一次调用。命令没填就直接失败，不猜默认执行器。 */
export function buildHarnessInvocation(model: Pick<ModelProfile, 'harness'>, prompt: string): HarnessInvocation {
  const command = model.harness?.command?.trim() ?? ''
  if (!command) throw new Error(text('这个执行器还没有填命令，请在设置里填写，例如 codex 或 gemini', 'This harness has no command yet; set one in Settings, for example codex or gemini'))
  const args = model.harness?.args ?? []
  const usesPlaceholder = args.some(arg => arg.includes(PROMPT_PLACEHOLDER))
  return {
    // argv[0] 是可执行文件本身，其余是参数，spawn 直接照着用。
    argv: [command, ...args.map(arg => arg.split(PROMPT_PLACEHOLDER).join(prompt))],
    stdin: usesPlaceholder ? undefined : prompt,
  }
}

/** 执行器没有 system 角色，把各段消息按顺序拼成一段。 */
function promptOf(messages: readonly { role: string; content: string }[]): string {
  return messages.map(message => message.content).join('\n\n')
}

function excerpt(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > STDERR_EXCERPT_LIMIT ? `${trimmed.slice(0, STDERR_EXCERPT_LIMIT)}…` : trimmed
}

interface HarnessRunResult {
  stdout: string
  stderr: string
  code: number | null
  aborted: boolean
}

/** 跑一次执行器，边跑边把 stdout 交出去。非零退出码交给调用方决定怎么说。 */
function runHarness(
  model: Pick<ModelProfile, 'harness'>,
  prompt: string,
  signal: AbortSignal | undefined,
  onStdout: (chunk: string) => void,
): Promise<HarnessRunResult> {
  const invocation = buildHarnessInvocation(model, prompt)
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.argv[0], invocation.argv.slice(1), {
      // Windows 上 codex、gemini 这类入口是 .cmd 脚本，必须经 shell 才能启动。
      shell: process.platform === 'win32',
      windowsHide: true,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let bytes = 0
    let aborted = false

    const stop = () => {
      aborted = true
      child.kill()
    }
    signal?.addEventListener('abort', stop, { once: true })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk, 'utf8')
      if (bytes > CLI_OUTPUT_LIMIT_BYTES) {
        stop()
        return
      }
      stdout += chunk
      onStdout(chunk)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })

    child.on('error', error => {
      signal?.removeEventListener('abort', stop)
      reject(new Error(error.message))
    })
    child.on('close', code => {
      signal?.removeEventListener('abort', stop)
      resolve({ stdout, stderr, code, aborted })
    })

    if (invocation.stdin === undefined) child.stdin.end()
    else child.stdin.end(invocation.stdin, 'utf8')
  })
}

/** 非零退出码与超限都算失败，报错带上执行器自己的 stderr，作者能看出是命令写错还是没登录。 */
function failureText(result: HarnessRunResult): string {
  if (Buffer.byteLength(result.stdout, 'utf8') > CLI_OUTPUT_LIMIT_BYTES) {
    return text('执行器的输出超过上限，已停止', 'The harness output passed the limit, so it was stopped')
  }
  const detail = excerpt(result.stderr) || excerpt(result.stdout)
  return text(
    `执行器以退出码 ${result.code ?? '未知'} 结束${detail ? `：${detail}` : ''}`,
    `The harness exited with code ${result.code ?? 'unknown'}${detail ? `: ${detail}` : ''}`,
  )
}

export class CliHarnessProvider implements ILLMProvider {
  async generate(
    model: ModelProfile,
    messages: Array<{ role: string; content: string }>,
    opts: LLMGenerateOptions,
  ): Promise<LLMResponse> {
    let result: HarnessRunResult
    try {
      result = await runHarness(model, promptOf(messages), opts.signal, () => undefined)
    } catch (error) {
      return { success: false, content: '', error: error instanceof Error ? error.message : String(error), finishReason: 'error' }
    }
    if (result.aborted) return { success: false, content: result.stdout, finishReason: 'cancelled' }
    if (result.code !== 0) return { success: false, content: result.stdout, error: failureText(result), finishReason: 'error' }
    return { success: true, content: result.stdout, finishReason: 'stop' }
  }

  async generateStream(
    model: ModelProfile,
    messages: Array<{ role: string; content: string }>,
    opts: LLMStreamOptions,
  ): Promise<void> {
    let result: HarnessRunResult
    try {
      result = await runHarness(model, promptOf(messages), opts.signal, chunk => opts.onChunk(chunk))
    } catch (error) {
      opts.onError(error instanceof Error ? error.message : String(error))
      return
    }
    if (result.aborted) {
      opts.onError(text('这次生成已取消', 'This generation was cancelled'), result.stdout)
      return
    }
    if (result.code !== 0) {
      opts.onError(failureText(result), result.stdout)
      return
    }
    // 本机执行器不报 token 用量，交给上层按「未知用量」记账。
    opts.onDone(result.stdout, undefined, 'stop')
  }
}
